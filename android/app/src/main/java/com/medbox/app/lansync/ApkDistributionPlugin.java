package com.medbox.app.lansync;

import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.webkit.MimeTypeMap;

import androidx.core.content.FileProvider;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.Inet4Address;
import java.net.InetSocketAddress;
import java.net.ServerSocket;
import java.net.Socket;
import java.net.SocketTimeoutException;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.RejectedExecutionException;
import java.util.concurrent.ThreadFactory;
import java.util.concurrent.atomic.AtomicInteger;

/**
 * 局域网 APK 自动更新（与 LanSyncPlugin 解耦）。
 *
 * 设计要点：
 * - 独立 TCP 端口 38473，与同步端口 38472 不冲突，也不受 LanSyncPlugin 单会话锁限制。
 * - 「已升级设备」作为分发源：startServer() 在 38473 监听，accept 后流式发送 APK 字节。
 * - 「待升级设备」调用 download() 连接对端 38473，把字节流写入 cache 路径。
 * - installApk() 通过 FileProvider + ACTION_VIEW 调起系统安装器。
 * - 协议极简：8 字节 magic + 4 字节版本号 + 8 字节文件长度 + 字节流。无加密（局域网内可信）。
 */
@CapacitorPlugin(name = "ApkDistribution")
public final class ApkDistributionPlugin extends Plugin {

    static final int APK_PORT = 38473;
    static final int CONNECT_TIMEOUT_MS = 10_000;
    static final int READ_TIMEOUT_MS = 60_000;
    static final int BUFFER_SIZE = 8 * 1024;

    private static final byte[] MAGIC = new byte[]{'M', 'B', 'A', 'P', 'K', '0', '0', '1'};

    private final Object serverLock = new Object();
    private final ExecutorService ioExecutor =
            Executors.newCachedThreadPool(new NamedThreadFactory("medbox-apk-io"));
    private ServerSocket activeServer;
    private File servingApk;

    /** 返回本机已安装 APK 的路径（context.getPackageCodePath()），供 TS 层启动分发。 */
    @PluginMethod
    public void getInstalledApkPath(PluginCall call) {
        try {
            String path = getContext().getPackageCodePath();
            JSObject result = new JSObject();
            result.put("apkPath", path);
            call.resolve(result);
        } catch (Exception error) {
            call.reject("Failed to get installed APK path: " + error.getMessage(), "GET_PATH_FAILED");
        }
    }

    /** 在本机 38473 监听，对外分发指定 APK 文件。重复调用会先关闭旧监听再开新监听。 */
    @PluginMethod
    public void startServer(PluginCall call) {
        String apkPath = call.getString("apkPath");
        if (apkPath == null || apkPath.isEmpty()) {
            call.reject("apkPath is required", "INVALID_PATH");
            return;
        }
        File apk = new File(apkPath);
        if (!apk.exists() || !apk.isFile()) {
            call.reject("APK file does not exist: " + apkPath, "FILE_NOT_FOUND");
            return;
        }

        synchronized (serverLock) {
            stopServerLocked();
            servingApk = apk;
            try {
                ServerSocket server = new ServerSocket();
                server.setReuseAddress(true);
                server.bind(new InetSocketAddress(APK_PORT));
                activeServer = server;
            } catch (IOException error) {
                servingApk = null;
                call.reject("Failed to bind APK server on port " + APK_PORT + ": " + error.getMessage(), "BIND_FAILED");
                return;
            }
        }

        try {
            ioExecutor.execute(() -> runAcceptLoop());
        } catch (RejectedExecutionException error) {
            synchronized (serverLock) {
                stopServerLocked();
            }
            call.reject("APK distribution is closed", "PLUGIN_CLOSED");
            return;
        }

        JSObject result = new JSObject();
        result.put("port", APK_PORT);
        result.put("apkPath", apk.getAbsolutePath());
        call.resolve(result);
    }

    /** 停止分发监听。 */
    @PluginMethod
    public void stopServer(PluginCall call) {
        synchronized (serverLock) {
            stopServerLocked();
        }
        call.resolve();
    }

    /** 连接对端 38473，把 APK 字节流下载到 destPath（一般是 cacheDir）。返回写入字节数。 */
    @PluginMethod
    public void download(PluginCall call) {
        String host = call.getString("host");
        Integer port = call.getInt("port");
        String destPath = call.getString("destPath");
        if (host == null || host.isEmpty()) {
            call.reject("host is required", "INVALID_HOST");
            return;
        }
        if (port == null || port < 1 || port > 65_535) {
            call.reject("port must be between 1 and 65535", "INVALID_PORT");
            return;
        }
        if (destPath == null || destPath.isEmpty()) {
            call.reject("destPath is required", "INVALID_PATH");
            return;
        }
        // 相对路径解析到 cacheDir，让 TS 层无需关心原生路径细节
        File dest = resolveStoragePath(destPath);
        if (dest == null) {
            call.reject("Cannot resolve destPath: " + destPath, "INVALID_PATH");
            return;
        }
        final String absolutePath = dest.getAbsolutePath();

        ioExecutor.execute(() -> {
            try {
                long bytes = doDownload(host, port, absolutePath);
                JSObject result = new JSObject();
                result.put("bytes", bytes);
                result.put("destPath", absolutePath);
                call.resolve(result);
            } catch (Exception error) {
                call.reject("APK download failed: " + error.getMessage(), "DOWNLOAD_FAILED");
            }
        });
    }

    /** 调起系统安装器安装指定 APK。 */
    @PluginMethod
    public void installApk(PluginCall call) {
        String apkPath = call.getString("apkPath");
        if (apkPath == null || apkPath.isEmpty()) {
            call.reject("apkPath is required", "INVALID_PATH");
            return;
        }
        File apk = new File(apkPath);
        if (!apk.exists() || !apk.isFile()) {
            call.reject("APK file does not exist: " + apkPath, "FILE_NOT_FOUND");
            return;
        }

        try {
            Context context = getContext();
            Intent intent = new Intent(Intent.ACTION_VIEW);
            String mimeType = MimeTypeMap.getSingleton().getMimeTypeFromExtension("apk");
            if (mimeType == null) mimeType = "application/vnd.android.package-archive";
            Uri uri = FileProvider.getUriForFile(context, context.getPackageName() + ".fileprovider", apk);
            intent.setDataAndType(uri, mimeType);
            intent.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK
                    | Intent.FLAG_GRANT_READ_URI_PERMISSION);
            context.startActivity(intent);
            call.resolve();
        } catch (Exception error) {
            call.reject("Failed to start installer: " + error.getMessage(), "INSTALL_FAILED");
        }
    }

    /** 删除 cache 中旧的 APK 文件（已安装或下载失败后清理）。 */
    @PluginMethod
    public void deleteApk(PluginCall call) {
        String apkPath = call.getString("apkPath");
        if (apkPath == null || apkPath.isEmpty()) {
            call.reject("apkPath is required", "INVALID_PATH");
            return;
        }
        File apk = new File(apkPath);
        boolean deleted = apk.exists() && apk.delete();
        JSObject result = new JSObject();
        result.put("deleted", deleted);
        call.resolve(result);
    }

    private void runAcceptLoop() {
        while (true) {
            ServerSocket server;
            File apk;
            synchronized (serverLock) {
                server = activeServer;
                apk = servingApk;
            }
            if (server == null || apk == null) break;
            Socket client;
            try {
                client = server.accept();
            } catch (SocketTimeoutException timeout) {
                continue;
            } catch (IOException error) {
                // server closed
                break;
            }
            try {
                ioExecutor.execute(() -> sendApkToClient(client, apk));
            } catch (RejectedExecutionException error) {
                try { client.close(); } catch (IOException ignored) {}
            }
        }
    }

    private void sendApkToClient(Socket client, File apk) {
        long totalSent = 0;
        try (OutputStream out = client.getOutputStream()) {
            // magic(8) + version(4) + length(8)
            out.write(MAGIC);
            out.write(new byte[]{0, 0, 0, 1});
            long length = apk.length();
            for (int i = 7; i >= 0; i--) {
                out.write((int) ((length >>> (i * 8)) & 0xFF));
            }
            try (InputStream in = new java.io.FileInputStream(apk)) {
                byte[] buffer = new byte[BUFFER_SIZE];
                int read;
                while ((read = in.read(buffer)) > 0) {
                    out.write(buffer, 0, read);
                    totalSent += read;
                }
            }
            out.flush();
        } catch (IOException error) {
            // client disconnected or write failed; log and move on
        } finally {
            try { client.close(); } catch (IOException ignored) {}
        }
    }

    private long doDownload(String host, int port, String destPath) throws IOException {
        File destFile = new File(destPath);
        File parent = destFile.getParentFile();
        if (parent != null && !parent.exists() && !parent.mkdirs()) {
            throw new IOException("Cannot create parent dir: " + parent.getAbsolutePath());
        }

        try (Socket socket = new Socket()) {
            socket.connect(new InetSocketAddress(host, port), CONNECT_TIMEOUT_MS);
            socket.setSoTimeout(READ_TIMEOUT_MS);
            InputStream in = socket.getInputStream();

            byte[] magic = readN(in, MAGIC.length);
            for (int i = 0; i < MAGIC.length; i++) {
                if (magic[i] != MAGIC[i]) {
                    throw new IOException("Invalid APK distribution protocol magic");
                }
            }
            byte[] version = readN(in, 4);
            // 当前只支持版本 1
            int v = ((version[0] & 0xFF) << 24) | ((version[1] & 0xFF) << 16)
                    | ((version[2] & 0xFF) << 8) | (version[3] & 0xFF);
            if (v != 1) throw new IOException("Unsupported APK distribution version: " + v);

            byte[] lengthBytes = readN(in, 8);
            long expected = 0;
            for (int i = 0; i < 8; i++) {
                expected = (expected << 8) | (lengthBytes[i] & 0xFF);
            }
            if (expected <= 0 || expected > 500L * 1024 * 1024) {
                throw new IOException("Invalid APK size: " + expected);
            }

            long received = 0;
            try (OutputStream out = new FileOutputStream(destFile)) {
                byte[] buffer = new byte[BUFFER_SIZE];
                int read;
                while (received < expected && (read = in.read(buffer)) > 0) {
                    out.write(buffer, 0, read);
                    received += read;
                }
                out.flush();
            }
            if (received != expected) {
                destFile.delete();
                throw new IOException("APK truncated: expected " + expected + ", got " + received);
            }
            return received;
        }
    }

    private static byte[] readN(InputStream in, int n) throws IOException {
        byte[] buf = new byte[n];
        int off = 0;
        while (off < n) {
            int read = in.read(buf, off, n - off);
            if (read < 0) throw new IOException("Unexpected EOF while reading header");
            off += read;
        }
        return buf;
    }

    /**
     * 把 destPath 解析为 File。
     * - 绝对路径直接使用。
     * - 相对路径（如 "medbox-update-20.apk"）解析到 getContext().getCacheDir()，
     *   让 TS 层无需关心原生路径细节，且 FileProvider 已配置 cache-path 可共享。
     */
    private File resolveStoragePath(String destPath) {
        if (destPath == null || destPath.isEmpty()) return null;
        File f = new File(destPath);
        if (f.isAbsolute()) return f;
        try {
            Context context = getContext();
            if (context == null) return null;
            File cacheDir = context.getCacheDir();
            if (cacheDir == null) return null;
            return new File(cacheDir, destPath);
        } catch (Exception error) {
            return null;
        }
    }

    private void stopServerLocked() {
        if (activeServer != null) {
            try { activeServer.close(); } catch (IOException ignored) {}
            activeServer = null;
        }
        servingApk = null;
    }

    private static final class NamedThreadFactory implements ThreadFactory {
        private final AtomicInteger counter = new AtomicInteger(1);
        private final String prefix;

        NamedThreadFactory(String prefix) {
            this.prefix = prefix;
        }

        @Override
        public Thread newThread(Runnable r) {
            Thread t = new Thread(r, prefix + "-" + counter.getAndIncrement());
            t.setDaemon(true);
            return t;
        }
    }
}

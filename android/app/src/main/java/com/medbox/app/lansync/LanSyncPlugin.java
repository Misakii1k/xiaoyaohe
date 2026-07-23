package com.medbox.app.lansync;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.EOFException;
import java.io.IOException;
import java.io.InputStream;
import java.net.Inet4Address;
import java.net.InetSocketAddress;
import java.net.ServerSocket;
import java.net.Socket;
import java.net.SocketTimeoutException;
import java.net.UnknownHostException;
import java.nio.charset.CharacterCodingException;
import java.util.UUID;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.RejectedExecutionException;
import java.util.concurrent.ThreadFactory;
import java.util.concurrent.atomic.AtomicInteger;

@CapacitorPlugin(name = "LanSync")
public final class LanSyncPlugin extends Plugin {
    private static final String STATE_EVENT = "lanSyncState";
    private static final String FRAME_EVENT = "lanSyncFrame";
    private static final int CONNECT_TIMEOUT_MS = 10_000;
    private static final int ACCEPT_TIMEOUT_MS = 120_000;
    private static final int READ_IDLE_TIMEOUT_MS = 30_000;

    private final Object sessionLock = new Object();
    private final ExecutorService ioExecutor = Executors.newCachedThreadPool(new NamedThreadFactory("medbox-lan-io"));
    private final ExecutorService writeExecutor = Executors.newSingleThreadExecutor(new NamedThreadFactory("medbox-lan-write"));
    private Session activeSession;

    @PluginMethod
    public void startHost(PluginCall call) {
        Session session = reserveSession(null, 0);
        if (session == null) {
            call.reject("A LAN sync session is already active", "SESSION_ACTIVE");
            return;
        }

        try {
            ioExecutor.execute(() -> runHost(session, call));
        } catch (RejectedExecutionException error) {
            terminateSession(session, "error", "PLUGIN_CLOSED");
            call.reject("LAN sync is closed", "PLUGIN_CLOSED");
        }
    }

    /** 返回当前本机可用于局域网同步的私有 IPv4，供自动同步身份公告。 */
    @PluginMethod
    public void getLocalAddress(PluginCall call) {
        try {
            Inet4Address address = LocalIpv4Address.select();
            JSObject result = new JSObject();
            result.put("host", address.getHostAddress());
            call.resolve(result);
        } catch (Exception error) {
            call.reject("No local Wi-Fi address is available", "NO_LAN_ADDRESS");
        }
    }

    @PluginMethod
    public void connect(PluginCall call) {
        String host = call.getString("host");
        Integer port = call.getInt("port");
        if (port == null || port < 1 || port > 65_535) {
            call.reject("Port must be between 1 and 65535", "INVALID_PORT");
            return;
        }

        final Inet4Address address;
        try {
            address = LocalIpv4Address.parse(host);
        } catch (UnknownHostException error) {
            call.reject("Host must be a private or link-local IPv4 address", "INVALID_HOST");
            return;
        }

        String canonicalHost = address.getHostAddress();
        Session session = reserveSession(canonicalHost, port);
        if (session == null) {
            call.reject("A LAN sync session is already active", "SESSION_ACTIVE");
            return;
        }
        if (!resolveConnecting(session, call)) {
            call.reject("LAN sync was closed", "SESSION_CLOSED");
            return;
        }

        try {
            ioExecutor.execute(() -> runConnect(session, address));
        } catch (RejectedExecutionException error) {
            terminateSession(session, "error", "PLUGIN_CLOSED");
        }
    }

    @PluginMethod
    public void send(PluginCall call) {
        String connectionId = call.getString("connectionId");
        String data = call.getString("data");
        if (connectionId == null || connectionId.isEmpty() || data == null) {
            call.reject("connectionId and data are required", "INVALID_ARGUMENT");
            return;
        }

        Session session = findSession(connectionId);
        Socket socket = session == null ? null : session.socketSnapshot();
        if (session == null || socket == null || !socket.isConnected() || socket.isClosed() || session.isClosed()) {
            call.reject("The LAN sync connection is not open", "NOT_CONNECTED");
            return;
        }

        try {
            writeExecutor.execute(() -> writeFrame(session, socket, data, call));
        } catch (RejectedExecutionException error) {
            call.reject("LAN sync is closed", "PLUGIN_CLOSED");
        }
    }

    @PluginMethod
    public void close(PluginCall call) {
        String connectionId = call.getString("connectionId");
        if (connectionId == null || connectionId.isEmpty()) {
            call.reject("connectionId is required", "INVALID_ARGUMENT");
            return;
        }

        Session session = findSession(connectionId);
        boolean closed = session != null && terminateSession(session, "closed", "LOCAL_CLOSED");
        JSObject result = new JSObject();
        result.put("closed", closed);
        call.resolve(result);
    }

    @Override
    protected void handleOnPause() {
        // 保活场景下切后台不主动断开会话：前台服务会让 WebView 与自动同步 host 监听继续存活。
        // 真正退出/销毁时仍由 handleOnDestroy 清理。
        super.handleOnPause();
    }

    @Override
    protected void handleOnDestroy() {
        terminateCurrentSession("closed", "APP_DESTROYED");
        ioExecutor.shutdownNow();
        writeExecutor.shutdownNow();
        super.handleOnDestroy();
    }

    private void runHost(Session session, PluginCall call) {
        ServerSocket listener = null;
        try {
            Inet4Address address = LocalIpv4Address.select();
            listener = new ServerSocket();
            // 自动同步可指定固定端口；手动二维码路径仍用 0 由系统分配临时端口。
            Integer preferredPort = call.getInt("port");
            int bindPort = preferredPort != null && preferredPort >= 1024 && preferredPort <= 65_535
                ? preferredPort
                : 0;
            listener.setReuseAddress(bindPort != 0);
            listener.bind(new InetSocketAddress(address, bindPort), 1);
            listener.setSoTimeout(ACCEPT_TIMEOUT_MS);
            session.setEndpoint(address.getHostAddress(), listener.getLocalPort());
            if (!session.attachServer(listener)) {
                closeQuietly(listener);
                call.reject("LAN sync was closed", "SESSION_CLOSED");
                return;
            }
        } catch (LocalIpv4Address.NoLocalAddressException error) {
            closeQuietly(listener);
            terminateSession(session, "error", "NO_LAN_ADDRESS");
            call.reject("No local Wi-Fi address is available", "NO_LAN_ADDRESS");
            return;
        } catch (IOException error) {
            closeQuietly(listener);
            terminateSession(session, "error", "HOST_START_FAILED");
            call.reject("Unable to start LAN sync", "HOST_START_FAILED");
            return;
        }

        if (!resolveListening(session, call)) {
            call.reject("LAN sync was closed", "SESSION_CLOSED");
            return;
        }

        Socket accepted = null;
        try {
            accepted = listener.accept();
            configureConnectedSocket(accepted);
            if (!session.promoteAcceptedSocket(listener, accepted)) {
                closeQuietly(accepted);
                closeQuietly(listener);
                return;
            }
            closeQuietly(listener);

            if (!LocalIpv4Address.isAllowed(accepted.getInetAddress())) {
                terminateSession(session, "error", "INVALID_PEER");
                return;
            }
            if (!emitOpenState(session, "connected", null)) {
                return;
            }
            readFrames(session, accepted);
        } catch (SocketTimeoutException error) {
            closeQuietly(accepted);
            if (!session.isClosed()) {
                terminateSession(session, "error", "ACCEPT_TIMEOUT");
            }
        } catch (IOException error) {
            closeQuietly(accepted);
            if (!session.isClosed()) {
                terminateSession(session, "error", "IO_ERROR");
            }
        }
    }

    private void runConnect(Session session, Inet4Address address) {
        Socket socket = new Socket();
        if (!session.attachSocket(socket)) {
            closeQuietly(socket);
            return;
        }

        try {
            socket.connect(new InetSocketAddress(address, session.port()), CONNECT_TIMEOUT_MS);
            configureConnectedSocket(socket);
            if (!emitOpenState(session, "connected", null)) {
                return;
            }
            readFrames(session, socket);
        } catch (SocketTimeoutException error) {
            terminateSession(session, "error", "CONNECT_TIMEOUT");
        } catch (IOException error) {
            terminateSession(session, "error", "CONNECT_FAILED");
        }
    }

    private void writeFrame(Session session, Socket expectedSocket, String data, PluginCall call) {
        Socket currentSocket = session.socketSnapshot();
        if (session.isClosed() || currentSocket != expectedSocket || expectedSocket.isClosed()) {
            call.reject("The LAN sync connection is closed", "SESSION_CLOSED");
            return;
        }

        try {
            int bytes = FrameCodec.writeFrame(expectedSocket.getOutputStream(), data);
            JSObject result = new JSObject();
            result.put("bytes", bytes);
            call.resolve(result);
        } catch (FrameCodec.FrameTooLargeException error) {
            boolean failed = terminateSession(session, "error", "FRAME_TOO_LARGE");
            call.reject("LAN sync frame is too large", failed ? "FRAME_TOO_LARGE" : "SESSION_CLOSED");
        } catch (CharacterCodingException error) {
            boolean failed = terminateSession(session, "error", "INVALID_UTF8");
            call.reject("LAN sync frame is not valid UTF-8", failed ? "INVALID_UTF8" : "SESSION_CLOSED");
        } catch (IOException error) {
            boolean failed = terminateSession(session, "error", "IO_ERROR");
            call.reject("Unable to send LAN sync frame", failed ? "IO_ERROR" : "SESSION_CLOSED");
        }
    }

    private void readFrames(Session session, Socket socket) {
        try {
            InputStream input = socket.getInputStream();
            while (!session.isClosed()) {
                String frame = FrameCodec.readFrame(input);
                if (!emitFrame(session, frame)) {
                    return;
                }
            }
        } catch (FrameCodec.EndOfStreamException error) {
            if (!session.isClosed()) {
                terminateSession(session, "closed", "REMOTE_CLOSED");
            }
        } catch (FrameCodec.FrameTooLargeException error) {
            if (!session.isClosed()) {
                terminateSession(session, "error", "FRAME_TOO_LARGE");
            }
        } catch (SocketTimeoutException error) {
            if (!session.isClosed()) {
                terminateSession(session, "error", "READ_TIMEOUT");
            }
        } catch (CharacterCodingException error) {
            if (!session.isClosed()) {
                terminateSession(session, "error", "INVALID_UTF8");
            }
        } catch (EOFException error) {
            if (!session.isClosed()) {
                terminateSession(session, "error", "TRUNCATED_FRAME");
            }
        } catch (IOException error) {
            if (!session.isClosed()) {
                terminateSession(session, "error", "IO_ERROR");
            }
        }
    }

    private Session reserveSession(String host, int port) {
        synchronized (sessionLock) {
            if (activeSession != null) {
                return null;
            }
            Session session = new Session(UUID.randomUUID().toString(), host, port);
            activeSession = session;
            return session;
        }
    }

    private Session findSession(String connectionId) {
        synchronized (sessionLock) {
            if (activeSession == null || !activeSession.id().equals(connectionId)) {
                return null;
            }
            return activeSession;
        }
    }

    private boolean resolveListening(Session session, PluginCall call) {
        synchronized (session.lifecycleLock()) {
            if (session.isClosedUnsafe()) {
                return false;
            }
            emitState(session, "listening", null);
            call.resolve(sessionInfo(session));
            return true;
        }
    }

    private boolean resolveConnecting(Session session, PluginCall call) {
        synchronized (session.lifecycleLock()) {
            if (session.isClosedUnsafe()) {
                return false;
            }
            emitState(session, "connecting", null);
            call.resolve(sessionInfo(session));
            return true;
        }
    }

    private boolean emitOpenState(Session session, String state, String code) {
        synchronized (session.lifecycleLock()) {
            if (session.isClosedUnsafe()) {
                return false;
            }
            emitState(session, state, code);
            return true;
        }
    }

    private boolean emitFrame(Session session, String frame) {
        synchronized (session.lifecycleLock()) {
            if (session.isClosedUnsafe()) {
                return false;
            }
            JSObject payload = new JSObject();
            payload.put("connectionId", session.id());
            payload.put("data", frame);
            notifyListeners(FRAME_EVENT, payload);
            return true;
        }
    }

    private boolean terminateSession(Session session, String state, String code) {
        synchronized (session.lifecycleLock()) {
            if (session.isClosedUnsafe()) {
                return false;
            }
            session.markClosedUnsafe();
        }

        session.closeResources();
        emitState(session, state, code);
        synchronized (sessionLock) {
            if (activeSession == session) {
                activeSession = null;
            }
        }
        return true;
    }

    private void terminateCurrentSession(String state, String code) {
        Session session;
        synchronized (sessionLock) {
            session = activeSession;
        }
        if (session != null) {
            terminateSession(session, state, code);
        }
    }

    private void emitState(Session session, String state, String code) {
        JSObject payload = sessionInfo(session);
        payload.put("state", state);
        if (code != null) {
            payload.put("code", code);
        }
        notifyListeners(STATE_EVENT, payload);
    }

    private static JSObject sessionInfo(Session session) {
        JSObject payload = new JSObject();
        payload.put("connectionId", session.id());
        if (session.host() != null) {
            payload.put("host", session.host());
        }
        if (session.port() > 0) {
            payload.put("port", session.port());
        }
        return payload;
    }

    private static void configureConnectedSocket(Socket socket) throws IOException {
        socket.setTcpNoDelay(true);
        socket.setSoTimeout(READ_IDLE_TIMEOUT_MS);
    }

    private static void closeQuietly(ServerSocket socket) {
        if (socket == null) {
            return;
        }
        try {
            socket.close();
        } catch (IOException ignored) {}
    }

    private static void closeQuietly(Socket socket) {
        if (socket == null) {
            return;
        }
        try {
            socket.close();
        } catch (IOException ignored) {}
    }

    static final class Session {
        private final String id;
        private final Object lifecycleLock = new Object();
        private final Object resourcesLock = new Object();
        private volatile String host;
        private volatile int port;
        private volatile boolean closed;
        private ServerSocket serverSocket;
        private Socket socket;

        Session(String id, String host, int port) {
            this.id = id;
            this.host = host;
            this.port = port;
        }

        String id() {
            return id;
        }

        String host() {
            return host;
        }

        int port() {
            return port;
        }

        Object lifecycleLock() {
            return lifecycleLock;
        }

        void setEndpoint(String host, int port) {
            this.host = host;
            this.port = port;
        }

        boolean attachServer(ServerSocket serverSocket) {
            synchronized (resourcesLock) {
                if (closed) {
                    return false;
                }
                this.serverSocket = serverSocket;
                return true;
            }
        }

        boolean attachSocket(Socket socket) {
            synchronized (resourcesLock) {
                if (closed) {
                    return false;
                }
                this.socket = socket;
                return true;
            }
        }

        boolean promoteAcceptedSocket(ServerSocket expectedServer, Socket acceptedSocket) {
            synchronized (resourcesLock) {
                if (closed || serverSocket != expectedServer) {
                    return false;
                }
                serverSocket = null;
                socket = acceptedSocket;
                return true;
            }
        }

        Socket socketSnapshot() {
            synchronized (resourcesLock) {
                return socket;
            }
        }

        boolean isClosed() {
            return closed;
        }

        boolean isClosedUnsafe() {
            return closed;
        }

        void markClosedUnsafe() {
            closed = true;
        }

        void closeResources() {
            synchronized (resourcesLock) {
                closeQuietly(serverSocket);
                closeQuietly(socket);
                serverSocket = null;
                socket = null;
            }
        }
    }

    private static final class NamedThreadFactory implements ThreadFactory {
        private final String prefix;
        private final AtomicInteger count = new AtomicInteger();

        NamedThreadFactory(String prefix) {
            this.prefix = prefix;
        }

        @Override
        public Thread newThread(Runnable runnable) {
            Thread thread = new Thread(runnable, prefix + "-" + count.incrementAndGet());
            thread.setDaemon(true);
            return thread;
        }
    }
}

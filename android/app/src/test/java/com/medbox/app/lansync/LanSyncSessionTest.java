package com.medbox.app.lansync;

import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertThrows;
import static org.junit.Assert.assertTrue;

import java.io.IOException;
import java.net.InetSocketAddress;
import java.net.Socket;
import java.net.SocketAddress;
import java.net.SocketException;
import java.net.SocketTimeoutException;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import org.junit.Test;

public class LanSyncSessionTest {

    @Test
    public void closingSessionClosesSocketThatIsStillConnecting() throws Exception {
        LanSyncPlugin.Session session = new LanSyncPlugin.Session(
            "test-connection",
            "192.168.1.20",
            49_152
        );
        TrackingSocket connectingSocket = new TrackingSocket();
        ExecutorService executor = Executors.newSingleThreadExecutor();

        try {
            assertTrue(session.attachSocket(connectingSocket));
            Future<?> connectTask = executor.submit(() -> assertThrows(
                IOException.class,
                () -> connectingSocket.connect(new InetSocketAddress("192.168.1.20", 49_152), 10_000)
            ));
            assertTrue(connectingSocket.connectStarted.await(1, TimeUnit.SECONDS));

            synchronized (session.lifecycleLock()) {
                session.markClosedUnsafe();
            }
            session.closeResources();

            connectTask.get(1, TimeUnit.SECONDS);
            assertTrue(connectingSocket.closeCalled);
            assertTrue(connectingSocket.isClosed());

            Socket replacement = new Socket();
            try {
                assertFalse(session.attachSocket(replacement));
            } finally {
                replacement.close();
            }
        } finally {
            session.closeResources();
            executor.shutdownNow();
        }
    }

    private static final class TrackingSocket extends Socket {
        private final CountDownLatch connectStarted = new CountDownLatch(1);
        private final CountDownLatch closeSignal = new CountDownLatch(1);
        private volatile boolean closeCalled;

        @Override
        public void connect(SocketAddress endpoint, int timeout) throws IOException {
            connectStarted.countDown();
            try {
                if (!closeSignal.await(2, TimeUnit.SECONDS)) {
                    throw new SocketTimeoutException("Test socket was not closed");
                }
            } catch (InterruptedException error) {
                Thread.currentThread().interrupt();
                throw new SocketException("Test connection was interrupted");
            }
            throw new SocketException("Test socket was closed");
        }

        @Override
        public synchronized void close() throws IOException {
            closeCalled = true;
            closeSignal.countDown();
            super.close();
        }
    }
}

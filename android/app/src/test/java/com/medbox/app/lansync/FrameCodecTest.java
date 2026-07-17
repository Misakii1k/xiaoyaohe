package com.medbox.app.lansync;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertThrows;

import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.EOFException;
import org.junit.Test;

public class FrameCodecTest {

    @Test
    public void roundTripsUtf8WithBigEndianLength() throws Exception {
        String frame = "hello-\u836f\u76d2";
        ByteArrayOutputStream output = new ByteArrayOutputStream();

        int payloadLength = FrameCodec.writeFrame(output, frame);
        byte[] encoded = output.toByteArray();

        assertEquals(payloadLength + 4, encoded.length);
        assertEquals(0, encoded[0]);
        assertEquals(0, encoded[1]);
        assertEquals(0, encoded[2]);
        assertEquals(payloadLength, encoded[3] & 0xff);
        assertEquals(frame, FrameCodec.readFrame(new ByteArrayInputStream(encoded)));
    }

    @Test
    public void rejectsPayloadOverEightMiB() {
        String frame = "a".repeat(FrameCodec.MAX_FRAME_BYTES + 1);

        assertThrows(
            FrameCodec.FrameTooLargeException.class,
            () -> FrameCodec.writeFrame(new ByteArrayOutputStream(), frame)
        );
    }

    @Test
    public void rejectsDeclaredLengthOverEightMiB() {
        int length = FrameCodec.MAX_FRAME_BYTES + 1;
        byte[] header = new byte[] {
            (byte) (length >>> 24),
            (byte) (length >>> 16),
            (byte) (length >>> 8),
            (byte) length,
        };

        assertThrows(
            FrameCodec.FrameTooLargeException.class,
            () -> FrameCodec.readFrame(new ByteArrayInputStream(header))
        );
    }

    @Test
    public void rejectsTruncatedHeader() {
        byte[] header = new byte[] { 0, 0 };

        assertThrows(EOFException.class, () -> FrameCodec.readFrame(new ByteArrayInputStream(header)));
    }

    @Test
    public void rejectsTruncatedPayload() {
        byte[] frame = new byte[] { 0, 0, 0, 4, 'o', 'k' };

        assertThrows(EOFException.class, () -> FrameCodec.readFrame(new ByteArrayInputStream(frame)));
    }
}

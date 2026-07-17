package com.medbox.app.lansync;

import java.io.EOFException;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.ByteBuffer;
import java.nio.CharBuffer;
import java.nio.charset.CharacterCodingException;
import java.nio.charset.CodingErrorAction;
import java.nio.charset.StandardCharsets;

public final class FrameCodec {
    public static final int MAX_FRAME_BYTES = 8 * 1024 * 1024;

    private FrameCodec() {}

    public static int writeFrame(OutputStream output, String frame) throws IOException {
        byte[] payload = encodeUtf8(frame);
        int length = payload.length;

        output.write((length >>> 24) & 0xff);
        output.write((length >>> 16) & 0xff);
        output.write((length >>> 8) & 0xff);
        output.write(length & 0xff);
        output.write(payload);
        output.flush();
        return length;
    }

    public static String readFrame(InputStream input) throws IOException {
        int first = input.read();
        if (first < 0) {
            throw new EndOfStreamException();
        }

        byte[] remainingHeader = new byte[3];
        readExactly(input, remainingHeader, "Truncated frame header");
        long length = ((long) first << 24)
            | ((long) (remainingHeader[0] & 0xff) << 16)
            | ((long) (remainingHeader[1] & 0xff) << 8)
            | (long) (remainingHeader[2] & 0xff);
        if (length > MAX_FRAME_BYTES) {
            throw new FrameTooLargeException(length);
        }

        byte[] payload = new byte[(int) length];
        readExactly(input, payload, "Truncated frame payload");
        return decodeUtf8(payload);
    }

    private static byte[] encodeUtf8(String frame) throws IOException {
        if (frame == null) {
            throw new IllegalArgumentException("Frame must not be null");
        }
        if (frame.length() > MAX_FRAME_BYTES) {
            throw new FrameTooLargeException(frame.length());
        }

        ByteBuffer encoded = StandardCharsets.UTF_8
            .newEncoder()
            .onMalformedInput(CodingErrorAction.REPORT)
            .onUnmappableCharacter(CodingErrorAction.REPORT)
            .encode(CharBuffer.wrap(frame));
        if (encoded.remaining() > MAX_FRAME_BYTES) {
            throw new FrameTooLargeException(encoded.remaining());
        }

        byte[] payload = new byte[encoded.remaining()];
        encoded.get(payload);
        return payload;
    }

    private static String decodeUtf8(byte[] payload) throws CharacterCodingException {
        return StandardCharsets.UTF_8
            .newDecoder()
            .onMalformedInput(CodingErrorAction.REPORT)
            .onUnmappableCharacter(CodingErrorAction.REPORT)
            .decode(ByteBuffer.wrap(payload))
            .toString();
    }

    private static void readExactly(InputStream input, byte[] destination, String errorMessage) throws IOException {
        int offset = 0;
        while (offset < destination.length) {
            int count = input.read(destination, offset, destination.length - offset);
            if (count < 0) {
                throw new EOFException(errorMessage);
            }
            if (count == 0) {
                int next = input.read();
                if (next < 0) {
                    throw new EOFException(errorMessage);
                }
                destination[offset++] = (byte) next;
                continue;
            }
            offset += count;
        }
    }

    public static final class EndOfStreamException extends EOFException {
        public EndOfStreamException() {
            super("End of stream");
        }
    }

    public static final class FrameTooLargeException extends IOException {
        public FrameTooLargeException(long length) {
            super("Frame exceeds " + MAX_FRAME_BYTES + " bytes: " + length);
        }
    }
}

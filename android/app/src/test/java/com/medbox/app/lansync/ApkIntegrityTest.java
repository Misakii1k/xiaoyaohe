package com.medbox.app.lansync;

import static org.junit.Assert.assertEquals;

import java.nio.charset.StandardCharsets;
import org.junit.Test;

public class ApkIntegrityTest {

    @Test
    public void computesFixedWidthLowercaseSha256() {
        assertEquals(
            "af4777d2e0fa417721b94dbd97f74371e1887f052ad936cb49b8eb6cb19e3f8b",
            ApkIntegrity.sha256Hex("a149".getBytes(StandardCharsets.UTF_8))
        );
    }

    @Test
    public void computesKnownEmptySha256() {
        assertEquals(
            "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
            ApkIntegrity.sha256Hex(new byte[0])
        );
    }
}

package com.medbox.app.lansync;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertThrows;

import java.net.UnknownHostException;
import org.junit.Test;

public class LocalIpv4AddressTest {

    @Test
    public void acceptsPrivateAndLinkLocalIpv4Ranges() throws Exception {
        String[] addresses = {
            "10.0.0.1",
            "172.16.0.1",
            "172.31.255.254",
            "192.168.1.20",
            "169.254.10.20",
        };

        for (String address : addresses) {
            assertEquals(address, LocalIpv4Address.parse(address).getHostAddress());
        }
    }

    @Test
    public void rejectsNonLocalAndAmbiguousAddresses() {
        String[] addresses = {
            "127.0.0.1",
            "8.8.8.8",
            "172.15.255.255",
            "172.32.0.1",
            "fe80::1",
            "phone.local",
            "192.168.001.2",
            "192.168.1.256",
        };

        for (String address : addresses) {
            assertThrows(UnknownHostException.class, () -> LocalIpv4Address.parse(address));
        }
    }
}

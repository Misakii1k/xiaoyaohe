package com.medbox.app.lansync;

import java.net.Inet4Address;
import java.net.InetAddress;
import java.net.NetworkInterface;
import java.net.SocketException;
import java.net.UnknownHostException;
import java.util.Enumeration;
import java.util.Locale;

final class LocalIpv4Address {
    private LocalIpv4Address() {}

    static Inet4Address select() throws SocketException, NoLocalAddressException {
        Enumeration<NetworkInterface> interfaces = NetworkInterface.getNetworkInterfaces();
        if (interfaces == null) {
            throw new NoLocalAddressException();
        }

        Inet4Address selected = null;
        int selectedScore = Integer.MIN_VALUE;
        while (interfaces.hasMoreElements()) {
            NetworkInterface networkInterface = interfaces.nextElement();
            if (!isUsable(networkInterface)) {
                continue;
            }

            int interfaceScore = scoreInterface(networkInterface.getName());
            Enumeration<InetAddress> addresses = networkInterface.getInetAddresses();
            while (addresses.hasMoreElements()) {
                InetAddress address = addresses.nextElement();
                if (!isAllowed(address)) {
                    continue;
                }

                int score = interfaceScore + (address.isSiteLocalAddress() ? 100 : 50);
                if (score > selectedScore) {
                    selected = (Inet4Address) address;
                    selectedScore = score;
                }
            }
        }

        if (selected == null) {
            throw new NoLocalAddressException();
        }
        return selected;
    }

    static Inet4Address parse(String host) throws UnknownHostException {
        if (host == null) {
            throw new UnknownHostException("Missing IPv4 address");
        }

        String[] components = host.split("\\.", -1);
        if (components.length != 4) {
            throw new UnknownHostException("Invalid IPv4 address");
        }

        byte[] bytes = new byte[4];
        for (int index = 0; index < components.length; index++) {
            String component = components[index];
            if (component.isEmpty() || (component.length() > 1 && component.charAt(0) == '0')) {
                throw new UnknownHostException("Invalid IPv4 address");
            }

            int value = 0;
            for (int charIndex = 0; charIndex < component.length(); charIndex++) {
                char character = component.charAt(charIndex);
                if (character < '0' || character > '9') {
                    throw new UnknownHostException("Invalid IPv4 address");
                }
                value = value * 10 + character - '0';
                if (value > 255) {
                    throw new UnknownHostException("Invalid IPv4 address");
                }
            }
            bytes[index] = (byte) value;
        }

        InetAddress address = InetAddress.getByAddress(bytes);
        if (!isAllowed(address)) {
            throw new UnknownHostException("IPv4 address is not local");
        }
        return (Inet4Address) address;
    }

    static boolean isAllowed(InetAddress address) {
        return address instanceof Inet4Address && (address.isSiteLocalAddress() || address.isLinkLocalAddress());
    }

    private static boolean isUsable(NetworkInterface networkInterface) {
        try {
            if (!networkInterface.isUp() || networkInterface.isLoopback() || networkInterface.isVirtual() || networkInterface.isPointToPoint()) {
                return false;
            }
        } catch (SocketException error) {
            return false;
        }

        String name = networkInterface.getName();
        if (name == null) {
            return true;
        }
        String lowerName = name.toLowerCase(Locale.ROOT);
        return !(lowerName.startsWith("tun")
            || lowerName.startsWith("vpn")
            || lowerName.startsWith("rmnet")
            || lowerName.startsWith("ccmni")
            || lowerName.startsWith("pdp"));
    }

    private static int scoreInterface(String name) {
        if (name == null) {
            return 0;
        }
        String lowerName = name.toLowerCase(Locale.ROOT);
        if (lowerName.startsWith("wlan") || lowerName.startsWith("wifi") || lowerName.startsWith("swlan") || lowerName.startsWith("ap")) {
            return 40;
        }
        if (lowerName.startsWith("eth") || lowerName.startsWith("en")) {
            return 30;
        }
        return 0;
    }

    static final class NoLocalAddressException extends Exception {
        NoLocalAddressException() {
            super("No private or link-local IPv4 address is available");
        }
    }
}

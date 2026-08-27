package com.medbox.app;

import static org.junit.Assert.assertEquals;

import org.junit.Test;

public class AppConfigurationTest {

    @Test
    public void buildUsesMedboxApplicationId() {
        assertEquals("com.medbox.app", BuildConfig.APPLICATION_ID);
        assertEquals("0.9.10", BuildConfig.VERSION_NAME);
        assertEquals(29, BuildConfig.VERSION_CODE);
    }
}

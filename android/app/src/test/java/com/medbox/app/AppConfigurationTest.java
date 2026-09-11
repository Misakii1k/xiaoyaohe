package com.medbox.app;

import static org.junit.Assert.assertEquals;

import org.junit.Test;

public class AppConfigurationTest {

    @Test
    public void buildUsesMedboxApplicationId() {
        assertEquals("com.medbox.app", BuildConfig.APPLICATION_ID);
        assertEquals("1.0.1", BuildConfig.VERSION_NAME);
        assertEquals(36, BuildConfig.VERSION_CODE);
    }
}

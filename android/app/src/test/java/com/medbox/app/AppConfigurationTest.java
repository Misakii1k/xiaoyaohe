package com.medbox.app;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

public class AppConfigurationTest {

    @Test
    public void buildUsesMedboxApplicationId() {
        assertEquals("com.medbox.app", BuildConfig.APPLICATION_ID);
        assertTrue(BuildConfig.VERSION_NAME.matches("0\\.[4-6]\\.[0-9]+"));
    }
}

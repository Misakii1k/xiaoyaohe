package com.medbox.app;

import static org.junit.Assert.assertEquals;

import org.junit.Test;

public class AppConfigurationTest {

    @Test
    public void buildUsesMedboxApplicationId() {
        assertEquals("com.medbox.app", BuildConfig.APPLICATION_ID);
        // 版本号随每次发版递增（package.json / build.gradle 同步维护），不做硬编码断言；
        // 版本一致性由 TS 侧 tests/versionManifest.test.ts 门禁覆盖。
    }
}

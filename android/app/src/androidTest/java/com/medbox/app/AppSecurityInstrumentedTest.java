package com.medbox.app;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertTrue;

import android.Manifest;
import android.content.ComponentName;
import android.content.Context;
import android.content.pm.ApplicationInfo;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import java.util.Arrays;
import java.util.List;
import org.junit.Test;
import org.junit.runner.RunWith;

@RunWith(AndroidJUnit4.class)
public class AppSecurityInstrumentedTest {

    @Test
    public void manifestKeepsHealthDataLocalAndDeclaresReminderCapabilities() throws Exception {
        Context context = InstrumentationRegistry.getInstrumentation().getTargetContext();
        PackageManager packageManager = context.getPackageManager();
        String packageName = context.getPackageName();

        assertEquals("com.medbox.app", packageName);
        ApplicationInfo applicationInfo = packageManager.getApplicationInfo(packageName, 0);
        assertEquals(0, applicationInfo.flags & ApplicationInfo.FLAG_ALLOW_BACKUP);

        PackageInfo packageInfo = packageManager.getPackageInfo(packageName, PackageManager.GET_PERMISSIONS);
        List<String> permissions = Arrays.asList(packageInfo.requestedPermissions);
        assertTrue(permissions.contains(Manifest.permission.POST_NOTIFICATIONS));
        assertTrue(permissions.contains(Manifest.permission.SCHEDULE_EXACT_ALARM));

        ComponentName receiver = new ComponentName(context, ReminderTimeChangeReceiver.class);
        assertNotNull(packageManager.getReceiverInfo(receiver, 0));
    }
}

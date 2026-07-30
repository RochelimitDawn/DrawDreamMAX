import java.util.Properties
import java.io.FileInputStream

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

val localProps = Properties().apply {
    val f = rootProject.file("local.properties")
    if (f.exists()) FileInputStream(f).use { load(it) }
}

fun propOrEnv(key: String, env: String = key): String? =
    (localProps.getProperty(key) ?: System.getenv(env))?.takeIf { it.isNotBlank() }

android {
    namespace = "com.drawdream.app"
    compileSdk = 35

    defaultConfig {
        applicationId = "com.drawdream.app"
        minSdk = 28
        targetSdk = 35
        versionCode = (System.getenv("DRAWDREAM_VERSION_CODE") ?: "1").toInt()
        versionName = System.getenv("DRAWDREAM_VERSION_NAME")
            ?: (rootProject.file("../../package.json").takeIf { it.exists() }?.readText()
                ?.let { Regex("\"version\"\\s*:\\s*\"([^\"]+)\"").find(it)?.groupValues?.get(1) }
                ?: "2.0.0-alpha.1")
        // 仅 arm64：内嵌 Node
        ndk {
            abiFilters += listOf("arm64-v8a")
        }
    }

    signingConfigs {
        create("release") {
            val storeFilePath = propOrEnv("KEYSTORE_FILE", "KEYSTORE_FILE")
            val storePassword = propOrEnv("KEYSTORE_PASSWORD", "KEYSTORE_PASSWORD")
            val keyAlias = propOrEnv("KEY_ALIAS", "KEY_ALIAS")
            val keyPassword = propOrEnv("KEY_PASSWORD", "KEY_PASSWORD")
            if (storeFilePath != null && storePassword != null && keyAlias != null && keyPassword != null) {
                storeFile = file(storeFilePath)
                this.storePassword = storePassword
                this.keyAlias = keyAlias
                this.keyPassword = keyPassword
            }
        }
    }

    buildTypes {
        debug {
            applicationIdSuffix = ".debug"
            isDebuggable = true
        }
        release {
            isMinifyEnabled = false
            val rel = signingConfigs.findByName("release")
            if (rel?.storeFile != null) {
                signingConfig = rel
            }
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro",
            )
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions {
        jvmTarget = "17"
    }
    packaging {
        jniLibs {
            // 必须解压到 nativeLibraryDir，才能作为可执行文件 ProcessBuilder 启动
            useLegacyPackaging = true
        }
        resources {
            excludes += setOf("META-INF/DEPENDENCIES", "META-INF/LICENSE*", "META-INF/NOTICE*")
        }
    }
}

dependencies {
    implementation("androidx.core:core-ktx:1.15.0")
    implementation("androidx.appcompat:appcompat:1.7.0")
    implementation("com.google.android.material:material:1.12.0")
    implementation("androidx.webkit:webkit:1.12.1")
    implementation("androidx.activity:activity-ktx:1.9.3")
}

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "com.ciccarelli.relais"
    compileSdk = 34

    defaultConfig {
        applicationId = "com.ciccarelli.relais"
        minSdk = 26
        targetSdk = 34
        versionCode = 6
        versionName = "0.7.0"
    }

    // The interface of the app (index.html, app.js) lives in web/app/: the same files are the
    // conductor's editor of setlists in the web version, so the two can never drift apart.
    sourceSets {
        getByName("main") {
            assets.setSrcDirs(listOf("../web/app"))
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = false
        }
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions {
        jvmTarget = "17"
    }
}

dependencies {
    implementation("androidx.core:core-ktx:1.13.1")
    implementation("androidx.appcompat:appcompat:1.7.0")
    implementation("androidx.activity:activity-ktx:1.9.0")
}

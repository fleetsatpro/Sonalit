pluginManagement {
    repositories {
        google {
            content {
                includeGroupByRegex("com\\.android.*")
                includeGroupByRegex("com\\.google.*")
                includeGroupByRegex("androidx.*")
            }
        }
        mavenCentral()
        gradlePluginPortal()
    }
}

dependencyResolutionManagement {
    repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS)
    repositories {
        google()
        mavenCentral()
        maven { url = uri("https://jitpack.io") }
        // Vosk offline speech recognition (voice panic trigger) — publishes here
        // in addition to/instead of Maven Central depending on release.
        maven { url = uri("https://alphacephei.com/maven/") }
    }
}

rootProject.name = "SonalitGuardian"
include(":app")

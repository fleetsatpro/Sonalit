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
    }
}

rootProject.name = "sonalit-guardian-v4"

// Guardian Agent v4 (Compose + Material 3)
include(":apps:guardian-android:app")
include(":apps:guardian-android:sdk-kotlin")

// Shared Kotlin contracts (generated from packages/contracts)
include(":packages:sdk-kotlin")

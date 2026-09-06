# Retrofit
-keepattributes Signature
-keepattributes *Annotation*
-keep class retrofit2.** { *; }
-keepclasseswithmembers class * { @retrofit2.http.* <methods>; }

# Moshi
-keep class com.squareup.moshi.** { *; }
-keep @com.squareup.moshi.JsonQualifier interface *
-keepclasseswithmembers class * { @com.squareup.moshi.* <methods>; }

# Hilt
-keep class dagger.hilt.** { *; }

# Room
-keep class * extends androidx.room.RoomDatabase { *; }

# App data models
-keep class io.sonalit.guardian.data.** { *; }

# OkHttp
-dontwarn okhttp3.**
-dontwarn okio.**

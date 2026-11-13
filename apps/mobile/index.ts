// The app entry. Defines the background task before Expo Router starts.
//
// A background run with the app closed loads this bundle with no UI. The task must
// already be defined by then. Importing it first here defines it whenever the bundle
// starts, whatever Expo Router does or does not load.
import './src/lib/background-refresh';
import 'expo-router/entry';

import { StatusBar } from "expo-status-bar";
import { useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Linking,
  Pressable,
  SafeAreaView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { WebView, type WebViewNavigation } from "react-native-webview";

const DEFAULT_FOCUSMAP_URL = "https://focusmap-official.com/dashboard";

function buildFocusmapUrl() {
  const configuredUrl = process.env.EXPO_PUBLIC_FOCUSMAP_URL?.trim() || DEFAULT_FOCUSMAP_URL;

  try {
    const url = new URL(configuredUrl);
    url.searchParams.set("source", "ios-app");
    url.searchParams.set("standalone", "1");
    return url.toString();
  } catch {
    return `${DEFAULT_FOCUSMAP_URL}?source=ios-app&standalone=1`;
  }
}

function isHttpUrl(url: string) {
  return url.startsWith("http://") || url.startsWith("https://");
}

function openExternalUrl(url: string) {
  Linking.openURL(url).catch(() => {
    Alert.alert("開けませんでした", "このリンクを開くアプリが見つかりません。");
  });
}

type ErrorState = {
  title: string;
  detail: string;
};

function ErrorFallback({
  error,
  onReload,
  onOpenBrowser,
}: {
  error: ErrorState;
  onReload: () => void;
  onOpenBrowser: () => void;
}) {
  return (
    <View style={styles.fallback}>
      <View style={styles.logoMark}>
        <Text style={styles.logoText}>F</Text>
      </View>
      <Text style={styles.fallbackTitle}>{error.title}</Text>
      <Text style={styles.fallbackDetail}>{error.detail}</Text>
      <View style={styles.actionRow}>
        <Pressable style={styles.primaryButton} onPress={onReload}>
          <Text style={styles.primaryButtonText}>再読み込み</Text>
        </Pressable>
        <Pressable style={styles.secondaryButton} onPress={onOpenBrowser}>
          <Text style={styles.secondaryButtonText}>Safariで開く</Text>
        </Pressable>
      </View>
    </View>
  );
}

export default function App() {
  const webViewRef = useRef<WebView>(null);
  const focusmapUrl = useMemo(buildFocusmapUrl, []);
  const [loadProgress, setLoadProgress] = useState(0);
  const [initialLoading, setInitialLoading] = useState(true);
  const [error, setError] = useState<ErrorState | null>(null);

  const handleShouldStartLoad = (request: WebViewNavigation) => {
    if (!request.url || request.url === "about:blank") return true;

    if (!isHttpUrl(request.url)) {
      openExternalUrl(request.url);
      return false;
    }

    return true;
  };

  const handleReload = () => {
    setError(null);
    setInitialLoading(true);
    setLoadProgress(0);
    webViewRef.current?.reload();
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar style="light" />
      <View style={styles.container}>
        {error ? (
          <ErrorFallback
            error={error}
            onReload={handleReload}
            onOpenBrowser={() => openExternalUrl(focusmapUrl)}
          />
        ) : (
          <>
            <WebView
              ref={webViewRef}
              source={{ uri: focusmapUrl }}
              style={styles.webView}
              applicationNameForUserAgent="FocusmapIOS"
              allowsBackForwardNavigationGestures
              domStorageEnabled
              javaScriptEnabled
              pullToRefreshEnabled
              setSupportMultipleWindows={false}
              sharedCookiesEnabled
              thirdPartyCookiesEnabled
              onShouldStartLoadWithRequest={handleShouldStartLoad}
              onLoadStart={() => {
                setError(null);
                setInitialLoading(true);
              }}
              onLoadProgress={({ nativeEvent }) => setLoadProgress(nativeEvent.progress)}
              onLoadEnd={() => setInitialLoading(false)}
              onError={({ nativeEvent }) => {
                setError({
                  title: "Focusmapを読み込めません",
                  detail: nativeEvent.description || "通信環境を確認して、もう一度読み込んでください。",
                });
              }}
              onHttpError={({ nativeEvent }) => {
                if (nativeEvent.statusCode >= 500) {
                  setError({
                    title: "サーバーが応答しません",
                    detail: `HTTP ${nativeEvent.statusCode} が返りました。少し待ってから再読み込みしてください。`,
                  });
                }
              }}
            />
            {loadProgress < 1 && (
              <View pointerEvents="none" style={styles.progressTrack}>
                <View style={[styles.progressFill, { width: `${Math.max(loadProgress, 0.08) * 100}%` }]} />
              </View>
            )}
            {initialLoading && (
              <View pointerEvents="none" style={styles.loadingOverlay}>
                <View style={styles.loadingPanel}>
                  <View style={styles.logoMark}>
                    <Text style={styles.logoText}>F</Text>
                  </View>
                  <Text style={styles.loadingTitle}>Focusmap</Text>
                  <Text style={styles.loadingDetail}>ダッシュボードを開いています</Text>
                  <ActivityIndicator color="#9ee493" style={styles.spinner} />
                </View>
              </View>
            )}
          </>
        )}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: "#050505",
  },
  container: {
    flex: 1,
    backgroundColor: "#050505",
  },
  webView: {
    flex: 1,
    backgroundColor: "#050505",
  },
  progressTrack: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    height: 2,
    backgroundColor: "rgba(255,255,255,0.08)",
  },
  progressFill: {
    height: 2,
    backgroundColor: "#9ee493",
  },
  loadingOverlay: {
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#050505",
  },
  loadingPanel: {
    alignItems: "center",
    gap: 8,
  },
  logoMark: {
    alignItems: "center",
    justifyContent: "center",
    width: 60,
    height: 60,
    borderRadius: 18,
    backgroundColor: "#121212",
    borderWidth: 1,
    borderColor: "rgba(158,228,147,0.35)",
  },
  logoText: {
    color: "#9ee493",
    fontSize: 28,
    fontWeight: "700",
  },
  loadingTitle: {
    marginTop: 8,
    color: "#f5f5f5",
    fontSize: 22,
    fontWeight: "700",
  },
  loadingDetail: {
    color: "#a6a6a6",
    fontSize: 14,
  },
  spinner: {
    marginTop: 14,
  },
  fallback: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 24,
    backgroundColor: "#050505",
  },
  fallbackTitle: {
    marginTop: 18,
    color: "#f5f5f5",
    fontSize: 22,
    fontWeight: "700",
    textAlign: "center",
  },
  fallbackDetail: {
    marginTop: 10,
    color: "#a6a6a6",
    fontSize: 15,
    lineHeight: 22,
    textAlign: "center",
  },
  actionRow: {
    flexDirection: "row",
    gap: 10,
    marginTop: 24,
  },
  primaryButton: {
    minHeight: 46,
    justifyContent: "center",
    borderRadius: 8,
    backgroundColor: "#9ee493",
    paddingHorizontal: 18,
  },
  primaryButtonText: {
    color: "#081008",
    fontSize: 15,
    fontWeight: "700",
  },
  secondaryButton: {
    minHeight: 46,
    justifyContent: "center",
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.18)",
    paddingHorizontal: 18,
  },
  secondaryButtonText: {
    color: "#f5f5f5",
    fontSize: 15,
    fontWeight: "700",
  },
});

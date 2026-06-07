import { StatusBar } from "expo-status-bar";
import * as Clipboard from "expo-clipboard";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  AppState,
  type AppStateStatus,
  Linking,
  Pressable,
  SafeAreaView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { WebView, type WebViewMessageEvent, type WebViewNavigation } from "react-native-webview";

const DEFAULT_FOCUSMAP_URL = "https://focusmap-official.com/dashboard";
const EXTERNAL_AUTH_HOSTS = new Set(["accounts.google.com", "oauth2.googleapis.com"]);
const STARTUP_OVERLAY_MAX_MS = 1200;
const CONTENT_READY_SCRIPT = `
(() => {
  if (window.__focusmapNativeReadyInstalled) return true;
  window.__focusmapNativeReadyInstalled = true;
  const postReady = () => {
    try {
      window.ReactNativeWebView?.postMessage(JSON.stringify({ type: "focusmap:web-content-ready" }));
    } catch {}
  };
  const hasContent = () => document.body && document.body.children && document.body.children.length > 0;
  const check = () => {
    if (hasContent()) {
      requestAnimationFrame(postReady);
      return;
    }
    setTimeout(check, 80);
  };
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", check, { once: true });
  } else {
    check();
  }
  return true;
})();
`;
const APP_RESUME_SCRIPT = `
(() => {
  try {
    window.dispatchEvent(new Event("focus"));
    window.dispatchEvent(new CustomEvent("focusmap:native-app-resume"));
    document.dispatchEvent(new Event("visibilitychange"));
  } catch {}
  return true;
})();
`;

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

function isExternalAuthUrl(value: string) {
  try {
    const url = new URL(value);
    return (
      EXTERNAL_AUTH_HOSTS.has(url.hostname) ||
      (url.hostname.endsWith(".supabase.co") && url.pathname.startsWith("/auth/v1/"))
    );
  } catch {
    return false;
  }
}

function normalizeExternalUrlCandidates(primaryUrl: string, urls?: string[]) {
  return [...new Set([primaryUrl, ...(urls || [])]
    .map(url => url.trim())
    .filter(Boolean))];
}

async function openExternalUrl(url: string, urls?: string[]) {
  const candidates = normalizeExternalUrlCandidates(url, urls);
  for (const candidate of candidates) {
    try {
      await Linking.openURL(candidate);
      return;
    } catch {
      // Try the next candidate. The final fallback is usually the official web URL.
    }
  }
  Alert.alert("開けませんでした", "このリンクを開くアプリが見つかりません。");
}

function copyTextToClipboard(text: string) {
  const value = text.replace(/\r\n?/g, "\n").trim();
  if (!value) return;
  Clipboard.setStringAsync(value).catch(() => undefined);
}

async function copyTextThenOpenExternal(text: string | undefined, url: string, urls?: string[]) {
  if (text) {
    await Clipboard.setStringAsync(text.replace(/\r\n?/g, "\n").trim()).catch(() => undefined);
  }
  void openExternalUrl(url, urls);
}

function withAppParams(url: URL) {
  url.searchParams.set("source", "ios-app");
  url.searchParams.set("standalone", "1");
  return url;
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
  const hasPresentedWebContentRef = useRef(false);
  const appStateRef = useRef<AppStateStatus>(AppState.currentState);
  const [focusmapUrl] = useState(buildFocusmapUrl);
  const [webViewUrl, setWebViewUrl] = useState(focusmapUrl);
  const [loadProgress, setLoadProgress] = useState(0);
  const [initialLoading, setInitialLoading] = useState(true);
  const [hasPresentedWebContent, setHasPresentedWebContent] = useState(false);
  const [hasDismissedStartupOverlay, setHasDismissedStartupOverlay] = useState(false);
  const [error, setError] = useState<ErrorState | null>(null);

  const markWebContentPresented = useCallback(() => {
    hasPresentedWebContentRef.current = true;
    setHasPresentedWebContent(true);
    setHasDismissedStartupOverlay(true);
    setInitialLoading(false);
  }, []);

  const buildInternalUrl = useCallback((pathOrUrl: string, params?: Record<string, string>) => {
    const base = new URL(focusmapUrl);
    const url = pathOrUrl.startsWith("http://") || pathOrUrl.startsWith("https://")
      ? new URL(pathOrUrl)
      : new URL(pathOrUrl || "/dashboard", base.origin);
    withAppParams(url);
    if (params) {
      Object.entries(params).forEach(([key, value]) => url.searchParams.set(key, value));
    }
    return url.toString();
  }, [focusmapUrl]);

  const navigateInsideApp = useCallback((pathOrUrl: string, params?: Record<string, string>) => {
    setError(null);
    setInitialLoading(true);
    if (!hasPresentedWebContentRef.current) {
      setHasDismissedStartupOverlay(false);
    }
    setLoadProgress(0);
    setWebViewUrl(buildInternalUrl(pathOrUrl, params));
  }, [buildInternalUrl]);

  const handleShouldStartLoad = (request: WebViewNavigation) => {
    if (!request.url || request.url === "about:blank") return true;

    if (isExternalAuthUrl(request.url)) {
      void openExternalUrl(request.url);
      return false;
    }

    if (!isHttpUrl(request.url)) {
      void openExternalUrl(request.url);
      return false;
    }

    return true;
  };

  const handleDeepLink = useCallback((urlValue: string | null) => {
    if (!urlValue) return;

    try {
      const url = new URL(urlValue);
      if (url.protocol !== "focusmap:") return;

      if (url.hostname === "auth-complete") {
        const nonce = url.searchParams.get("nonce");
        const next = url.searchParams.get("next") || "/dashboard";
        if (!nonce) {
          Alert.alert("ログインを反映できません", "ログイン情報が見つかりませんでした。");
          return;
        }
        navigateInsideApp("/auth/native-bridge", { nonce, next });
        return;
      }

      if (url.hostname === "calendar-connected") {
        const next = url.searchParams.get("next") || "/dashboard";
        navigateInsideApp(next, { calendar_connected: "true" });
      }
    } catch {
      // Ignore unrelated deep links.
    }
  }, [navigateInsideApp]);

  const handleWebViewMessage = (event: WebViewMessageEvent) => {
    try {
      const payload = JSON.parse(event.nativeEvent.data) as { type?: string; url?: string; urls?: string[]; text?: string };
      if (payload.type === "focusmap:web-content-ready") {
        markWebContentPresented();
        return;
      }
      if (payload.type === "focusmap:copyText" && typeof payload.text === "string") {
        copyTextToClipboard(payload.text);
        return;
      }
      if (payload.type === "focusmap:copyAndOpenExternal" && payload.url) {
        void copyTextThenOpenExternal(payload.text, payload.url, Array.isArray(payload.urls) ? payload.urls : undefined);
        return;
      }
      if (payload.type === "focusmap:openExternal" && payload.url) {
        void openExternalUrl(payload.url, Array.isArray(payload.urls) ? payload.urls : undefined);
      }
    } catch {
      // Ignore non-JSON messages from the embedded page.
    }
  };

  const handleReload = () => {
    setError(null);
    setInitialLoading(true);
    if (!hasPresentedWebContentRef.current) {
      setHasDismissedStartupOverlay(false);
    }
    setLoadProgress(0);
    webViewRef.current?.reload();
  };

  useEffect(() => {
    if (!initialLoading || hasPresentedWebContent || hasDismissedStartupOverlay) return;

    const handle = setTimeout(() => {
      setHasDismissedStartupOverlay(true);
    }, STARTUP_OVERLAY_MAX_MS);

    return () => clearTimeout(handle);
  }, [hasDismissedStartupOverlay, hasPresentedWebContent, initialLoading]);

  useEffect(() => {
    Linking.getInitialURL().then(handleDeepLink).catch(() => undefined);
    const subscription = Linking.addEventListener("url", ({ url }) => handleDeepLink(url));
    return () => subscription.remove();
  }, [handleDeepLink]);

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (nextState) => {
      const previousState = appStateRef.current;
      appStateRef.current = nextState;

      if ((previousState === "inactive" || previousState === "background") && nextState === "active") {
        webViewRef.current?.injectJavaScript(APP_RESUME_SCRIPT);
      }
    });

    return () => subscription.remove();
  }, []);

  const showLoadingOverlay = initialLoading && !hasPresentedWebContent && !hasDismissedStartupOverlay;

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar style="light" />
      <View style={styles.container}>
        {error ? (
          <ErrorFallback
            error={error}
            onReload={handleReload}
            onOpenBrowser={() => void openExternalUrl(focusmapUrl)}
          />
        ) : (
          <>
            <WebView
              ref={webViewRef}
              source={{ uri: webViewUrl }}
              style={styles.webView}
              applicationNameForUserAgent="FocusmapIOS"
              allowsBackForwardNavigationGestures
              allowsInlineMediaPlayback
              domStorageEnabled
              javaScriptEnabled
              cacheEnabled
              cacheMode="LOAD_DEFAULT"
              injectedJavaScriptBeforeContentLoaded={CONTENT_READY_SCRIPT}
              mediaCapturePermissionGrantType="grantIfSameHostElsePrompt"
              mediaPlaybackRequiresUserAction={false}
              pullToRefreshEnabled={false}
              setSupportMultipleWindows={false}
              sharedCookiesEnabled
              thirdPartyCookiesEnabled
              onShouldStartLoadWithRequest={handleShouldStartLoad}
              onMessage={handleWebViewMessage}
              onLoadStart={() => {
                setError(null);
                setInitialLoading(true);
                if (!hasPresentedWebContentRef.current) {
                  setHasDismissedStartupOverlay(false);
                }
              }}
              onLoadProgress={({ nativeEvent }) => setLoadProgress(nativeEvent.progress)}
              onLoadEnd={markWebContentPresented}
              onContentProcessDidTerminate={() => {
                setInitialLoading(true);
                webViewRef.current?.reload();
              }}
              onError={({ nativeEvent }) => {
                setInitialLoading(false);
                if (!hasPresentedWebContentRef.current) {
                  setError({
                    title: "Focusmapを読み込めません",
                    detail: nativeEvent.description || "通信環境を確認して、もう一度読み込んでください。",
                  });
                }
              }}
              onHttpError={({ nativeEvent }) => {
                if (nativeEvent.statusCode >= 500 && !hasPresentedWebContentRef.current) {
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
            {showLoadingOverlay && (
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

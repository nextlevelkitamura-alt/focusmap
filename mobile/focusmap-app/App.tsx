import { StatusBar } from "expo-status-bar";
import * as Clipboard from "expo-clipboard";
import * as SplashScreen from "expo-splash-screen";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  Alert,
  AppState,
  type AppStateStatus,
  Linking,
  NativeModules,
  Platform,
  Pressable,
  SafeAreaView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { WebView, type WebViewMessageEvent, type WebViewNavigation } from "react-native-webview";

const DEFAULT_FOCUSMAP_URL = "https://focusmap-official.com/dashboard";
const CHATGPT_CODEX_MOBILE_URL = "https://chatgpt.com/codex/mobile/";
const EXTERNAL_AUTH_HOSTS = new Set(["accounts.google.com", "oauth2.googleapis.com"]);
const WEBVIEW_BACKGROUND = "#050505";
const STARTUP_HOURS = Array.from({ length: 11 }, (_, index) => 10 + index);
const CONTENT_READY_SCRIPT = `
(() => {
  if (window.__focusmapNativeReadyInstalled) return true;
  window.__focusmapNativeReadyInstalled = true;
  const ensureDarkBackground = () => {
    try {
      document.documentElement.style.backgroundColor = "${WEBVIEW_BACKGROUND}";
      if (document.body) document.body.style.backgroundColor = "${WEBVIEW_BACKGROUND}";
      if (!document.getElementById("focusmap-native-startup-style")) {
        const style = document.createElement("style");
        style.id = "focusmap-native-startup-style";
        style.textContent = "html,body{background:${WEBVIEW_BACKGROUND} !important;} body{min-height:100vh;}";
        document.head?.appendChild(style);
      }
    } catch {}
  };
  ensureDarkBackground();
  const postReady = () => {
    try {
      window.ReactNativeWebView?.postMessage(JSON.stringify({ type: "focusmap:web-content-ready" }));
    } catch {}
  };
  const hasContent = () => document.body && document.body.children && document.body.children.length > 0;
  const check = () => {
    ensureDarkBackground();
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

void SplashScreen.preventAutoHideAsync().catch(() => undefined);

type FocusmapExternalOpenerModule = {
  openUniversalLink?: (url: string) => Promise<boolean>;
  copyCodexHandoff?: (text: string, imageUrl?: string | null) => Promise<boolean>;
  copyCodexImage?: (imageUrl?: string | null) => Promise<boolean>;
};

const focusmapExternalOpener = NativeModules.FocusmapExternalOpener as FocusmapExternalOpenerModule | undefined;

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

function shouldOpenAsUniversalLinkOnly(url: string) {
  if (Platform.OS !== "ios") return false;
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" && parsed.hostname === "chatgpt.com" && parsed.pathname.startsWith("/codex/mobile");
  } catch {
    return false;
  }
}

async function openExternalUrl(url: string, urls?: string[]) {
  const candidates = normalizeExternalUrlCandidates(url, urls);
  for (const candidate of candidates) {
    try {
      if (shouldOpenAsUniversalLinkOnly(candidate) && focusmapExternalOpener?.openUniversalLink) {
        await focusmapExternalOpener.openUniversalLink(candidate);
        return;
      }
      await Linking.openURL(candidate);
      return;
    } catch {
      // Try the next candidate. The final fallback is usually the official web URL.
    }
  }
  if (candidates.some(candidate => candidate === CHATGPT_CODEX_MOBILE_URL)) {
    try {
      await Linking.openURL(CHATGPT_CODEX_MOBILE_URL);
      return;
    } catch {
      // Fall through to the alert below.
    }
  }
  Alert.alert("開けませんでした", "このリンクを開くアプリが見つかりません。");
}

function copyTextToClipboard(text: string) {
  const value = text.replace(/\r\n?/g, "\n").trim();
  if (!value) return;
  Clipboard.setStringAsync(value).catch(() => undefined);
}

async function copyCodexHandoffToClipboard(text: string | undefined, imageUrl?: string | null) {
  const value = text?.replace(/\r\n?/g, "\n").trim() || "";
  if (!value) return;

  if (focusmapExternalOpener?.copyCodexHandoff) {
    try {
      await focusmapExternalOpener.copyCodexHandoff(value, imageUrl || null);
      return;
    } catch {
      // Fall back to text-only clipboard support below.
    }
  }

  await Clipboard.setStringAsync(value).catch(() => undefined);
}

async function copyCodexImageToClipboard(imageUrl?: string | null) {
  const value = imageUrl?.trim() || "";
  if (!value || !focusmapExternalOpener?.copyCodexImage) return;

  try {
    await focusmapExternalOpener.copyCodexImage(value);
  } catch {
    // The web UI will keep the copy button available for another attempt.
  }
}

async function copyTextThenOpenExternal(text: string | undefined, url: string, urls?: string[], imageUrl?: string | null) {
  if (text) await copyCodexHandoffToClipboard(text, imageUrl);
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

type StartupSnapshotEvent = {
  id?: string;
  title: string;
  startTime: string;
  endTime: string;
  color?: string | null;
  backgroundColor?: string | null;
};

type StartupSnapshot = {
  dateLabel?: string;
  eventCount?: number;
  events: StartupSnapshotEvent[];
  savedAt?: string;
};

function formatStartupDateLabel() {
  const now = new Date();
  const weekdays = ["日", "月", "火", "水", "木", "金", "土"];
  return `${now.getMonth() + 1}月${now.getDate()}日(${weekdays[now.getDay()]})`;
}

function formatStartupTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

function normalizeStartupSnapshot(value: unknown): StartupSnapshot | null {
  const snapshot = value as Partial<StartupSnapshot> | null;
  if (!snapshot || typeof snapshot !== "object" || !Array.isArray(snapshot.events)) return null;

  const events = snapshot.events
    .map((event): StartupSnapshotEvent | null => {
      if (!event || typeof event !== "object") return null;
      const source = event as Partial<StartupSnapshotEvent>;
      if (typeof source.title !== "string" || typeof source.startTime !== "string" || typeof source.endTime !== "string") return null;
      return {
        id: typeof source.id === "string" ? source.id : undefined,
        title: source.title,
        startTime: source.startTime,
        endTime: source.endTime,
        color: typeof source.color === "string" ? source.color : null,
        backgroundColor: typeof source.backgroundColor === "string" ? source.backgroundColor : null,
      };
    })
    .filter((event): event is StartupSnapshotEvent => event !== null)
    .slice(0, 20);

  return {
    dateLabel: typeof snapshot.dateLabel === "string" ? snapshot.dateLabel : undefined,
    eventCount: typeof snapshot.eventCount === "number" ? snapshot.eventCount : events.length,
    events,
    savedAt: typeof snapshot.savedAt === "string" ? snapshot.savedAt : undefined,
  };
}

function CalendarGlyph({ active = false }: { active?: boolean }) {
  return (
    <View style={[styles.calendarGlyph, active && styles.calendarGlyphActive]}>
      <View style={styles.calendarGlyphTop} />
      <View style={styles.calendarGlyphGrid}>
        <View style={styles.calendarGlyphDot} />
        <View style={styles.calendarGlyphDot} />
        <View style={styles.calendarGlyphDot} />
        <View style={styles.calendarGlyphDot} />
      </View>
    </View>
  );
}

function StartupCalendarShell({ snapshot }: { snapshot: StartupSnapshot | null }) {
  const dateLabel = snapshot?.dateLabel || formatStartupDateLabel();
  const eventCount = snapshot?.eventCount ?? snapshot?.events.length ?? 0;
  const eventsByHour = new Map<number, StartupSnapshotEvent>();

  for (const event of snapshot?.events ?? []) {
    const start = new Date(event.startTime);
    if (Number.isNaN(start.getTime())) continue;
    const hour = start.getHours();
    if (!eventsByHour.has(hour)) eventsByHour.set(hour, event);
  }

  return (
    <View style={styles.startupShell}>
      <View style={styles.startupHeader}>
        <View style={styles.startupTitleBlock}>
          <Text style={styles.startupDate}>{dateLabel}</Text>
          <Text style={styles.startupMeta}>
            {eventCount > 0 ? `${eventCount}件のスケジュール` : "予定を確認中"}
          </Text>
        </View>
        <View style={styles.startupHeaderActions}>
          <View style={styles.startupSegment}>
            <Text style={[styles.startupSegmentText, styles.startupSegmentActive]}>Day</Text>
            <Text style={styles.startupSegmentText}>3days</Text>
            <Text style={styles.startupSegmentText}>Month</Text>
          </View>
          <View style={styles.startupAiButton}>
            <Text style={styles.startupAiText}>AI</Text>
          </View>
        </View>
      </View>

      <View style={styles.startupTimeline}>
        {STARTUP_HOURS.map((hour) => {
          const event = eventsByHour.get(hour);
          return (
            <View key={hour} style={styles.startupHourRow}>
              <Text style={styles.startupHourLabel}>{hour}:00</Text>
              <View style={styles.startupSlot}>
                {event ? (
                  <View
                    style={[
                      styles.startupEventCard,
                      {
                        borderLeftColor: event.color || "#8ee8c1",
                        backgroundColor: event.backgroundColor || "rgba(45,102,82,0.72)",
                      },
                    ]}
                  >
                    <Text style={styles.startupEventTitle} numberOfLines={1}>
                      {event.title || "予定"}
                    </Text>
                    <Text style={styles.startupEventTime}>
                      {formatStartupTime(event.startTime)} - {formatStartupTime(event.endTime)}
                    </Text>
                  </View>
                ) : (
                  <View style={styles.startupEmptySlot} />
                )}
              </View>
            </View>
          );
        })}
      </View>

      <View style={styles.startupBottomNav}>
        {[
          { label: "Todo", active: true },
          { label: "メモ" },
          { label: "マップ" },
          { label: "チャット" },
          { label: "設定" },
        ].map((item) => (
          <View key={item.label} style={styles.startupNavItem}>
            {item.active ? (
              <CalendarGlyph active />
            ) : (
              <View style={styles.startupNavIcon} />
            )}
            <Text style={[styles.startupNavLabel, item.active && styles.startupNavLabelActive]}>
              {item.label}
            </Text>
          </View>
        ))}
      </View>
    </View>
  );
}

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
  const [isRecoveringWebContent, setIsRecoveringWebContent] = useState(false);
  const [error, setError] = useState<ErrorState | null>(null);
  const [startupSnapshot, setStartupSnapshot] = useState<StartupSnapshot | null>(null);

  useEffect(() => {
    SplashScreen.hide();
  }, []);

  const markWebContentPresented = useCallback(() => {
    hasPresentedWebContentRef.current = true;
    setHasPresentedWebContent(true);
    setIsRecoveringWebContent(false);
    setInitialLoading(false);
    setLoadProgress(1);
  }, []);

  const prepareForWebViewLoad = useCallback((options?: { recovering?: boolean }) => {
    setError(null);
    setLoadProgress(0);

    if (hasPresentedWebContentRef.current) {
      setInitialLoading(false);
      setIsRecoveringWebContent(options?.recovering === true);
      return;
    }

    setInitialLoading(true);
    setIsRecoveringWebContent(false);
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
    prepareForWebViewLoad();
    setWebViewUrl(buildInternalUrl(pathOrUrl, params));
  }, [buildInternalUrl, prepareForWebViewLoad]);

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
      const payload = JSON.parse(event.nativeEvent.data) as {
        type?: string;
        url?: string;
        urls?: string[];
        text?: string;
        imageUrl?: string | null;
      };
      if (payload.type === "focusmap:web-content-ready") {
        markWebContentPresented();
        return;
      }
      if (payload.type === "focusmap:startup-snapshot") {
        const snapshot = normalizeStartupSnapshot((payload as { payload?: unknown }).payload);
        if (snapshot) setStartupSnapshot(snapshot);
        return;
      }
      if (payload.type === "focusmap:copyText" && typeof payload.text === "string") {
        copyTextToClipboard(payload.text);
        return;
      }
      if (payload.type === "focusmap:copyCodexHandoff" && typeof payload.text === "string") {
        void copyCodexHandoffToClipboard(payload.text, payload.imageUrl);
        return;
      }
      if (payload.type === "focusmap:copyCodexImage") {
        void copyCodexImageToClipboard(payload.imageUrl);
        return;
      }
      if (payload.type === "focusmap:copyCodexHandoffAndOpenExternal" && payload.url) {
        void copyTextThenOpenExternal(
          payload.text,
          payload.url,
          Array.isArray(payload.urls) ? payload.urls : undefined,
          payload.imageUrl,
        );
        return;
      }
      if (payload.type === "focusmap:copyAndOpenExternal" && payload.url) {
        void copyTextThenOpenExternal(
          payload.text,
          payload.url,
          Array.isArray(payload.urls) ? payload.urls : undefined,
          payload.imageUrl,
        );
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
    prepareForWebViewLoad({ recovering: hasPresentedWebContentRef.current });
    webViewRef.current?.reload();
  };

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

  const showLoadingOverlay = initialLoading && !hasPresentedWebContent;

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
              containerStyle={styles.webViewContainer}
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
              renderLoading={() => <View pointerEvents="none" style={styles.webViewLoadingSurface} />}
              onLoadStart={() => prepareForWebViewLoad()}
              onLoadProgress={({ nativeEvent }) => setLoadProgress(nativeEvent.progress)}
              onLoadEnd={markWebContentPresented}
              onContentProcessDidTerminate={() => {
                prepareForWebViewLoad({ recovering: hasPresentedWebContentRef.current });
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
            {isRecoveringWebContent && (
              <View pointerEvents="none" style={styles.recoverySurface}>
                <View style={styles.recoveryHeader}>
                  <View style={styles.recoveryTitle} />
                  <View style={styles.recoveryPill} />
                </View>
                <View style={styles.recoveryBlock} />
                <View style={styles.recoveryBlockShort} />
              </View>
            )}
            {loadProgress < 1 && (
              <View pointerEvents="none" style={styles.progressTrack}>
                <View style={[styles.progressFill, { width: `${Math.max(loadProgress, 0.08) * 100}%` }]} />
              </View>
            )}
            {showLoadingOverlay && (
              <View pointerEvents="none" style={styles.loadingOverlay}>
                <StartupCalendarShell snapshot={startupSnapshot} />
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
    backgroundColor: WEBVIEW_BACKGROUND,
  },
  container: {
    flex: 1,
    backgroundColor: WEBVIEW_BACKGROUND,
  },
  webViewContainer: {
    flex: 1,
    backgroundColor: WEBVIEW_BACKGROUND,
  },
  webView: {
    flex: 1,
    backgroundColor: WEBVIEW_BACKGROUND,
  },
  webViewLoadingSurface: {
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    backgroundColor: WEBVIEW_BACKGROUND,
  },
  recoverySurface: {
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    zIndex: -1,
    paddingHorizontal: 16,
    paddingTop: 18,
    backgroundColor: WEBVIEW_BACKGROUND,
  },
  recoveryHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 14,
  },
  recoveryTitle: {
    width: 150,
    height: 28,
    borderRadius: 7,
    backgroundColor: "rgba(255,255,255,0.14)",
  },
  recoveryPill: {
    width: 86,
    height: 34,
    borderRadius: 17,
    backgroundColor: "rgba(255,255,255,0.10)",
  },
  recoveryBlock: {
    height: 180,
    borderRadius: 8,
    backgroundColor: "rgba(255,255,255,0.08)",
  },
  recoveryBlockShort: {
    height: 86,
    marginTop: 12,
    borderRadius: 8,
    backgroundColor: "rgba(255,255,255,0.06)",
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
    alignItems: "stretch",
    justifyContent: "flex-start",
    backgroundColor: "#050505",
  },
  startupShell: {
    flex: 1,
    backgroundColor: "#050607",
  },
  startupHeader: {
    minHeight: 92,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    borderBottomWidth: 1,
    borderBottomColor: "rgba(255,255,255,0.10)",
    paddingHorizontal: 16,
    paddingBottom: 12,
    paddingTop: 10,
    backgroundColor: "#090b0d",
  },
  startupTitleBlock: {
    flex: 1,
    minWidth: 0,
  },
  startupDate: {
    color: "#f7f7f7",
    fontSize: 25,
    fontWeight: "800",
    letterSpacing: 0,
  },
  startupMeta: {
    marginTop: 4,
    color: "#8d8f94",
    fontSize: 13,
    fontWeight: "600",
  },
  startupHeaderActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  startupSegment: {
    height: 42,
    flexDirection: "row",
    alignItems: "center",
    gap: 2,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.14)",
    backgroundColor: "rgba(255,255,255,0.06)",
    padding: 3,
  },
  startupSegmentText: {
    minWidth: 46,
    height: 34,
    borderRadius: 10,
    color: "#9b9da3",
    overflow: "hidden",
    paddingHorizontal: 7,
    paddingTop: 8,
    textAlign: "center",
    fontSize: 12,
    fontWeight: "800",
  },
  startupSegmentActive: {
    color: "#f7f7f7",
    backgroundColor: "#000000",
  },
  startupAiButton: {
    height: 42,
    minWidth: 52,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.14)",
    backgroundColor: "rgba(255,255,255,0.06)",
  },
  startupAiText: {
    color: "#d4d4d8",
    fontSize: 13,
    fontWeight: "800",
  },
  startupTimeline: {
    flex: 1,
    paddingLeft: 14,
    paddingRight: 16,
    paddingTop: 6,
  },
  startupHourRow: {
    minHeight: 58,
    flexDirection: "row",
  },
  startupHourLabel: {
    width: 52,
    paddingTop: 9,
    color: "#6f7279",
    fontSize: 12,
    fontWeight: "600",
  },
  startupSlot: {
    flex: 1,
    minHeight: 58,
    borderTopWidth: 1,
    borderTopColor: "rgba(255,255,255,0.07)",
    paddingVertical: 5,
  },
  startupEmptySlot: {
    height: 38,
    borderRadius: 8,
    backgroundColor: "rgba(255,255,255,0.035)",
  },
  startupEventCard: {
    minHeight: 42,
    borderLeftWidth: 4,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  startupEventTitle: {
    color: "#f4f4f5",
    fontSize: 13,
    fontWeight: "700",
  },
  startupEventTime: {
    marginTop: 2,
    color: "#c7c7cc",
    fontSize: 10,
    fontWeight: "600",
  },
  startupBottomNav: {
    height: 76,
    flexDirection: "row",
    borderTopWidth: 1,
    borderTopColor: "rgba(255,255,255,0.10)",
    backgroundColor: "rgba(5,6,7,0.98)",
  },
  startupNavItem: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
  },
  startupNavIcon: {
    width: 24,
    height: 24,
    borderRadius: 7,
    borderWidth: 2,
    borderColor: "#6d7076",
    opacity: 0.82,
  },
  startupNavLabel: {
    color: "#8e929a",
    fontSize: 11,
    fontWeight: "700",
  },
  startupNavLabelActive: {
    color: "#58a6ff",
  },
  calendarGlyph: {
    width: 25,
    height: 25,
    borderRadius: 7,
    borderWidth: 2,
    borderColor: "#6d7076",
    overflow: "hidden",
  },
  calendarGlyphActive: {
    borderColor: "#58a6ff",
  },
  calendarGlyphTop: {
    height: 7,
    borderBottomWidth: 2,
    borderBottomColor: "rgba(88,166,255,0.9)",
    backgroundColor: "rgba(88,166,255,0.10)",
  },
  calendarGlyphGrid: {
    flex: 1,
    flexDirection: "row",
    flexWrap: "wrap",
    paddingHorizontal: 4,
    paddingVertical: 3,
    gap: 3,
  },
  calendarGlyphDot: {
    width: 4,
    height: 4,
    borderRadius: 2,
    backgroundColor: "#58a6ff",
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

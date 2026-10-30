/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { Router, HashRouter, Navigate, Route, useLocation, useNavigate } from '@solidjs/router';
import { ColorModeProvider } from '@kobalte/core';
import { ErrorBoundary, Match, Show, Suspense, Switch, createEffect, createRenderEffect, createResource, createSignal, onCleanup, onMount, type Component, type JSX } from 'solid-js';
import { Toaster } from "@/components/ui/sonner";
import { RouteError, clearModuleReloadMark, reloadOnceAfterModuleError } from "@/components/route-error";
import { LoadingScreen, PageLoader } from "@/components/page-loader";

import { AuthProvider, useAuth } from '@/context/auth';
import { connectorEnabled } from '@/ai-editor/connector';
import { PersistRoute } from '@/lib/persist-route';
import { useColorMode } from "@kobalte/core";
import { mainBridge } from "@/lib/ipc";
import { signedInUserId } from '@/lib/guest';
import { MAIN_CHANNELS } from "@desktop/main-channels";
import { dashboardTheme } from "@/lib/dashboard-theme";
import { AnalyticsConsent } from '@/components/analytics-consent';
import { ScreenTooSmall } from '@/components/screen-too-small';
import { UnsupportedBrowser } from '@/components/unsupported-browser';
import { OAuthConsentPage, ResumeConsent, rememberConsent, takeConsent } from '@/pages/oauth-consent';
import { rememberReturn, takeReturn } from '@/lib/return-after-sign-in';
import { DASHBOARD_PATH, TRY_PATH, dashboardRoute, isEditorPath, isSitePath, useProjectRef } from '@/hooks/use-project-route';
import { startCheckout, takeCheckout } from '@/lib/billing';
import { t } from '@/lib/i18n';
import { page } from '@/lib/lazy-page';
import { site } from '@/lib/site';

// Every page loads when it's opened, so the homepage (the site's, lib/site.ts)
// draws without waiting for the rest.
const DashboardPage = page(() => import('@/pages/dashboard'), (module) => module.DashboardPage);
const ProjectPage = page(() => import('@/pages/project'), (module) => module.ProjectPage);
const PostPreviewPage = page(() => import('@/pages/post-preview'), (module) => module.PostPreviewPage);
const ConnectLinkPage = page(() => import('@/pages/connect'), (module) => module.ConnectLinkPage);
const LoginPage = page(() => import('@/pages/login'), (module) => module.LoginPage);
const AuthCallbackPage = page(() => import('@/pages/auth-callback'), (module) => module.AuthCallbackPage);
const AuthConfirmPage = page(() => import('@/pages/auth-confirm'), (module) => module.AuthConfirmPage);
const TikTokCallbackPage = page(() => import('@/pages/tiktok-callback'), (module) => module.TikTokCallbackPage);
const YouTubeCallbackPage = page(() => import('@/pages/youtube-callback'), (module) => module.YouTubeCallbackPage);
const BlueskyCallbackPage = page(() => import('@/pages/bluesky-callback'), (module) => module.BlueskyCallbackPage);
const LinkedInCallbackPage = page(() => import('@/pages/linkedin-callback'), (module) => module.LinkedInCallbackPage);
const XCallbackPage = page(() => import('@/pages/x-callback'), (module) => module.XCallbackPage);
const InstagramCallbackPage = page(() => import('@/pages/meta-callback'), (module) => module.InstagramCallbackPage);
const FacebookCallbackPage = page(() => import('@/pages/meta-callback'), (module) => module.FacebookCallbackPage);
const ThreadsCallbackPage = page(() => import('@/pages/meta-callback'), (module) => module.ThreadsCallbackPage);
const NotFoundPage = page(() => import('@/pages/not-found'), (module) => module.NotFoundPage);
// Upgrading and a finished purchase only concern someone signed in, so these load after sign-in.
const UpgradeDialog = page(() => import('@/components/upgrade-dialog'), (module) => module.UpgradeDialog);
const PurchaseSuccess = page(() => import('@/components/purchase-success'), (module) => module.PurchaseSuccess);
// Only someone trying the dashboard in guest mode is asked to create an account.
const GuestAccountDialog = page(() => import('@/components/guest-account-dialog'), (module) => module.GuestAccountDialog);
const AgentConfirmDialog = page(() => import('@/components/agent-confirm'), (module) => module.AgentConfirmDialog);
const GuestFrame = page(() => import('@/components/guest-frame'), (module) => module.GuestFrame);

/**
 * Desktop tool handlers pull in export, capture, and the editor engine.
 * The website never calls them (the bridge only listens on `window.desktop`),
 * so the web dev server must not compile that graph during startup.
 */
function DeferredEditorApi() {
  const [ToolHost, setToolHost] = createSignal<Component | undefined>();

  onMount(() => {
    if (!window.desktop) return;
    void import('@/dapi/tools').then((module) => setToolHost(() => module.EditorApi));
  });

  return (
    <Show when={ToolHost()}>
      {(host) => {
        const Host = host();
        return <Host />;
      }}
    </Show>
  );
}

/** How many of the site's pages are on screen where the app would be, as the sign-in is at /dashboard for someone signed out. */
const [sitePagesInApp, setSitePagesInApp] = createSignal(0);

/**
 * One of the site's pages, shown in place of the app: it takes the site's
 * theme like the others (EditorColorMode). Counted as it's made, not once it
 * has drawn, so the theme turns together with the address and the page never
 * starts out in the app's colours.
 */
function SitePage(props: { children: JSX.Element }) {
  setSitePagesInApp((count) => count + 1);
  onCleanup(() => setSitePagesInApp((count) => count - 1));
  return props.children;
}

/** In place of the app for an account not let in yet, when there is no site and so no waitlist page. */
function NoAccess() {
  return <div class="grid h-dvh place-items-center bg-background px-6 text-center text-[15px] text-muted-foreground">{t("This account doesn't have access yet.")}</div>;
}

function AuthGate(props: { children: JSX.Element }) {
  const auth = useAuth();
  return (
    <Show when={!auth.isLoading() && !auth.isCheckingAccess()} fallback={<PageLoader />}>
      <Switch>
        <Match when={!auth.isAuthenticated()}>
          <SitePage>
            <LoginPage />
          </SitePage>
        </Match>
        <Match when={!auth.hasAccess()}>
          <SitePage>{site ? <site.WaitlistedPage /> : <NoAccess />}</SitePage>
        </Match>
        <Match when>{props.children}</Match>
      </Switch>
    </Show>
  );
}

/**
 * Goes on to Stripe with the plan picked on the pricing page before signing
 * in, from Billing, where a failed checkout leaves the plans to pick again.
 */
function ResumeCheckout() {
  const auth = useAuth();
  const navigate = useNavigate();

  createEffect(() => {
    if (window.desktop || auth.isLoading() || auth.isCheckingAccess() || !auth.isAuthenticated() || !auth.hasAccess()) return;
    void takeCheckout().then((chosen) => {
      if (!chosen) return;
      navigate(dashboardRoute('billing'), { replace: true });
      // Someone already paying picks the switch in Billing, where a downgrade is confirmed first.
      if (!auth.isPro()) void startCheckout(chosen.plan, chosen.billing, chosen.accounts);
    });
  });

  return null;
}

/**
 * Answers agents that connect at plan.video/mcp, from any page, while someone
 * with access is signed in. Loaded after sign-in so the public site stays light.
 */
function AgentConnector() {
  const auth = useAuth();

  createEffect(() => {
    if (!connectorEnabled || !auth.isAuthenticated() || !auth.hasAccess()) return;
    let stop: (() => void) | undefined;
    let cancelled = false;
    void import('@/lib/agent-connector').then((module) => {
      if (!cancelled) stop = module.startAgentConnector(auth.user);
    });
    onCleanup(() => {
      cancelled = true;
      stop?.();
    });
  });

  // Where the person allows or refuses what an agent asks to publish, delete or schedule.
  return (
    <Show when={connectorEnabled && auth.isAuthenticated() && auth.hasAccess()}>
      <Suspense>
        <AgentConfirmDialog />
      </Suspense>
    </Show>
  );
}

/** The HTML's copy of the home page's headline stays only while the home page is on its way. */
function HeroShell() {
  const location = useLocation();
  const auth = useAuth();

  createEffect(() => {
    if (location.pathname !== '/' || auth.isAuthenticated()) site?.removeHeroShell();
  });

  return null;
}

function SignedInDialogs() {
  const auth = useAuth();
  return (
    <Show when={auth.isAuthenticated()}>
      <Suspense>
        <UpgradeDialog />
        <PurchaseSuccess />
      </Suspense>
    </Show>
  );
}

function GuestDialogs() {
  const auth = useAuth();
  return (
    <Show when={auth.isGuest()}>
      <Suspense>
        <GuestAccountDialog />
      </Suspense>
    </Show>
  );
}

function CloudSync() {
  const auth = useAuth();

  createEffect(() => {
    // Each person signing in syncs their own projects.
    if (window.desktop || !signedInUserId() || !auth.isAuthenticated() || !auth.hasAccess()) return;
    void import('@/projects/cloud-sync').then((module) => module.startProjectSync());
    void import('@/lib/media-library').then((module) => module.flushMediaDeletes());
  });

  return null;
}

/** The editor's half of the Windows title bar; the dashboard sets its own. */
function TitleBarColorMode() {
  const location = useLocation();
  const { colorMode } = useColorMode();

  createEffect(() => {
    if (window.desktop?.platform === "win32" && isEditorPath(location.pathname)) {
      mainBridge.call(MAIN_CHANNELS.WINDOW_SET_COLOR_MODE, { mode: colorMode() });
    };
  });

  return null;
}

/**
 * The editor and the site's pages take the theme picked in the dashboard (or
 * in the site's footer), and until one is picked they are dark
 * (lib/dashboard-theme.ts); the dashboard draws its own palette over the dark
 * one. On the site, `site-light` on <html> turns the site's own colours too
 * (index.css), as index.html does before the first paint. The sign-in and
 * the waitlist count as the site wherever AuthGate shows them; at an app
 * address the loader covers the window until they have drawn.
 */
function EditorColorMode() {
  const location = useLocation();
  const { setColorMode } = useColorMode();

  createRenderEffect(() => {
    const site = isSitePath(location.pathname) || sitePagesInApp() > 0;
    setColorMode(site || isEditorPath(location.pathname) ? dashboardTheme() : 'dark');
    document.documentElement.classList.toggle('site-light', site && dashboardTheme() === 'light');
  });

  return null;
}

/**
 * Log in or sign up, for someone signed out; anyone signed in goes on to the
 * dashboard, or back to the page they came from (`?next=`, the roadmap or the
 * changelog).
 */
function AuthPageRoute(props: { mode?: 'login' | 'signup' }) {
  const auth = useAuth();
  const navigate = useNavigate();
  // The router's address, not the window's: following a link here, the window
  // only takes the new address once this page has been drawn.
  const next = new URLSearchParams(useLocation().search).get('next');
  if (next) rememberReturn(next);

  // Once: Supabase tells of a sign-in more than once, and this page stays up
  // while a lazy page loads, so a second go would find the return taken and
  // send them to the dashboard instead.
  let sent = false;
  createEffect(() => {
    if (sent || auth.isLoading() || !auth.isAuthenticated()) return;
    sent = true;
    navigate(takeReturn() ?? DASHBOARD_PATH, { replace: true });
  });

  return (
    <Show when={!auth.isLoading() && !auth.isAuthenticated()}>
      <LoginPage mode={props.mode} />
    </Show>
  );
}

/**
 * Connecting Claude: the approval page, behind the same gate as the editor.
 * Signed out, the address is kept so the sign-in comes back here.
 */
function OAuthConsentRoute() {
  const auth = useAuth();

  createEffect(() => {
    if (auth.isLoading()) return;
    if (auth.isAuthenticated()) takeConsent();
    else rememberConsent();
  });

  return (
    <AuthGate>
      <OAuthConsentPage />
    </AuthGate>
  );
}

const LoginRoute = () => <AuthPageRoute />;
const SignupRoute = () => <AuthPageRoute mode="signup" />;

/**
 * Whether this page load is a Google sign-in coming back (`/?code=…`). Read
 * as the app starts, before Supabase swaps the code for a session and takes
 * it out of the address, and used once: coming back to `/` later shows the
 * homepage.
 */
const [arrivingFromSignIn, setArrivingFromSignIn] = createSignal(new URLSearchParams(window.location.search).has('code'));

/**
 * The homepage, signed in or out, as Buffer's is: the nav's button becomes
 * Open dashboard. Only a Google sign-in landing here goes on to the app, or
 * back where it started.
 */
function HomeRoute() {
  const auth = useAuth();
  const navigate = useNavigate();

  // Sent on once, as from the login page (AuthPageRoute).
  let sent = false;
  createEffect(() => {
    if (sent || !arrivingFromSignIn() || auth.isLoading()) return;
    if (!auth.isAuthenticated()) return void setArrivingFromSignIn(false);
    sent = true;
    navigate(takeReturn() ?? DASHBOARD_PATH, { replace: true });
  });
  // Cleared on the way out, so the homepage doesn't show for a moment first.
  onCleanup(() => setArrivingFromSignIn(false));

  return (
    <Show when={!arrivingFromSignIn()} fallback={<PageLoader />}>
      {site && <site.HomePage />}
    </Show>
  );
}

function DashboardRoute() {
  return (
    <AuthGate>
      <DashboardPage />
    </AuthGate>
  );
}

/**
 * Guest mode's own place, like Buffer's: the dashboard and editor without an
 * account, under /try, apart from the account's. Anyone signed in goes on to
 * their own, at `account`.
 */
function GuestGate(props: { account: string; children: JSX.Element }) {
  const auth = useAuth();
  return (
    <Show when={!auth.isLoading()} fallback={<PageLoader />}>
      <Show when={!auth.isAuthenticated() && !window.desktop} fallback={<Navigate href={props.account} />}>
        <GuestStart>{props.children}</GuestStart>
      </Show>
    </Show>
  );
}

/** Opens guest mode's demo, today's or a new one, before the dashboard opens its stores. */
function GuestStart(props: { children: JSX.Element }) {
  const [demo] = createResource(() => import('@/lib/guest-demo').then((module) => module.openDemo()));
  return (
    <Show when={demo.state === 'ready' || demo.state === 'errored'} fallback={<PageLoader />}>
      {props.children}
    </Show>
  );
}

function TryRoute() {
  const location = useLocation();
  return (
    <GuestGate account={`${DASHBOARD_PATH}${location.search}`}>
      <GuestFrame>
        <DashboardPage />
      </GuestFrame>
    </GuestGate>
  );
}

function TryProjectRoute() {
  const ref = useProjectRef();
  return (
    <GuestGate account={`/projects/${encodeURIComponent(ref())}`}>
      <GuestFrame>
        <ProjectPage />
      </GuestFrame>
    </GuestGate>
  );
}

function EnvironmentOverlays() {
  const location = useLocation();
  // Pages that open on a phone and in any browser.
  const anywhere = () => {
    const path = location.pathname;
    if (path.startsWith('/checkout')) return true;
    // The public site is readable on a phone and in any browser. The editor is not.
    if (!window.desktop && (path === '/' || path === '/login' || path === '/signup' || path === '/login/reviewer' || path === '/auth/confirm' || path === '/terms' || path === '/privacy' || path === '/data-deletion' || path === '/integrations' || path === '/pricing' || path === '/about' || path === '/support')) return true;
    // A shared post preview and a connect link are opened by clients, on whatever they have.
    if (path.startsWith('/p/') || path.startsWith('/connect/')) return true;
    if (!window.desktop && (path.startsWith('/integrations/') || path.startsWith('/features/') || path === '/docs' || path.startsWith('/docs/'))) return true;
    if (!window.desktop && (path === '/alternatives' || path.startsWith('/alternatives/') || path === '/character-limits' || path.startsWith('/character-limits/') || path === '/roadmap' || path.startsWith('/roadmap/') || path === '/changelog' || path === '/blog' || path.startsWith('/blog/'))) return true;
    if (!window.desktop && (path === '/agents' || path.startsWith('/agents/'))) return true;
    if (!window.desktop && (path === '/tools' || path.startsWith('/tools/'))) return true;
    // Signing in, connecting a network and approving an AI connector land back
    // here in whatever browser started them, often the AI app's own.
    if (path === '/auth/callback' || path === '/oauth/consent' || /^\/(tiktok|youtube|bluesky|linkedin|x|instagram|facebook|threads)\/callback$/.test(path)) return true;
    return false;
  };
  // Guest mode's dashboard works in any browser on a big enough screen; its editor still needs Chromium.
  const anyBrowser = () => anywhere() || location.pathname === TRY_PATH;

  return (
    <>
      <Show when={!anywhere()}>
        <ScreenTooSmall />
      </Show>
      <Show when={!anyBrowser()}>
        <UnsupportedBrowser />
      </Show>
    </>
  );
}

// A production build reports a chunk it could not preload (a deploy replaced the
// files under an open tab) with this event: reload once instead of failing.
window.addEventListener("vite:preloadError", (event) => {
  if (reloadOnceAfterModuleError()) event.preventDefault();
});
// Once a page has been up for a while, a later hiccup may reload again.
window.setTimeout(clearModuleReloadMark, 10_000);

function App() {
  const RouterComponent = window.desktop ? HashRouter : Router;
  return (
    <RouterComponent
      root={(props) => (
        <ColorModeProvider initialColorMode="dark">
          <AuthProvider>
            <ErrorBoundary fallback={(error, reset) => <RouteError error={error} reset={reset} />}>
              <Suspense fallback={<PageLoader />}>{props.children}</Suspense>
            </ErrorBoundary>
            <LoadingScreen />
            <CloudSync />
            <AgentConnector />
            <ResumeConsent />
            <ResumeCheckout />
            <SignedInDialogs />
            <GuestDialogs />
            <HeroShell />
            <DeferredEditorApi />
          </AuthProvider>
          <Toaster />
          <AnalyticsConsent />
          <EnvironmentOverlays />
          {site && <site.SiteScrollbar />}
          <PersistRoute />
          <EditorColorMode />
          <TitleBarColorMode />
        </ColorModeProvider>
      )}
    >
      <Route path="/auth/callback" component={AuthCallbackPage} />
      <Route path="/auth/confirm" component={AuthConfirmPage} />
      <Route path="/oauth/consent" component={OAuthConsentRoute} />
      <Route path="/tiktok/callback" component={TikTokCallbackPage} />
      <Route path="/youtube/callback" component={YouTubeCallbackPage} />
      <Route path="/bluesky/callback" component={BlueskyCallbackPage} />
      <Route path="/linkedin/callback" component={LinkedInCallbackPage} />
      <Route path="/x/callback" component={XCallbackPage} />
      <Route path="/instagram/callback" component={InstagramCallbackPage} />
      <Route path="/facebook/callback" component={FacebookCallbackPage} />
      <Route path="/threads/callback" component={ThreadsCallbackPage} />
      <Route path="/login/reviewer" component={LoginRoute} />
      <Route path="/login" component={LoginRoute} />
      <Route path="/signup" component={SignupRoute} />
      {site && <site.SiteRoutes />}
      <Route path="/p/:id" component={PostPreviewPage} />
      <Route path="/connect/:link" component={ConnectLinkPage} />
      <Route path="/dashboard" component={DashboardRoute} />      {/* Desktop opens straight into the app. The website keeps that screen at /dashboard. */}
      {/* Without the site there is no homepage: `/` is the dashboard too. */}
      <Route path="/" component={window.desktop || !site ? DashboardRoute : HomeRoute} />
      <Route path="/projects/*ref" component={() => <AuthGate><ProjectPage /></AuthGate>} />
      <Route path={TRY_PATH} component={TryRoute} />
      <Route path={`${TRY_PATH}/projects/*ref`} component={TryProjectRoute} />
      <Route path="*404" component={NotFoundPage} />
    </RouterComponent>
  );
}

export default App;

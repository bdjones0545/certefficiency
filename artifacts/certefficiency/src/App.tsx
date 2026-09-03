import { lazy, Suspense, useEffect } from 'react';
import { QueryClient, QueryCache, QueryClientProvider } from '@tanstack/react-query';
import { ApiError } from '@workspace/api-client-react';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import { Route, Switch, Router as WouterRouter, useLocation } from 'wouter';

const Landing = lazy(() => import('./pages/landing'));
const Home = lazy(() => import('./pages/home'));
const Login = lazy(() => import('./pages/auth/login'));
const Register = lazy(() => import('./pages/auth/register'));
const ForgotPassword = lazy(() => import('./pages/auth/forgot-password'));
const ResetPassword = lazy(() => import('./pages/auth/reset-password'));
const Settings = lazy(() => import('./pages/settings'));
const Exam = lazy(() => import('./pages/exam'));
const ExamResults = lazy(() => import('./pages/exam/results'));
const VideoCourse = lazy(() => import('./pages/video-course'));
const AiCourse = lazy(() => import('./pages/ai-course'));
const CourseSuccess = lazy(() => import('./pages/course-success'));
const NotFound = lazy(() => import('@/pages/not-found'));

const ROUTE_TITLES: Array<[string, string]> = [
  ['/auth/login', 'Sign in'],
  ['/auth/register', 'Create account'],
  ['/auth/forgot-password', 'Forgot password'],
  ['/auth/reset-password', 'Reset password'],
  ['/settings', 'Settings'],
  ['/video-course', 'Video course'],
  ['/course/success', 'Course access'],
  ['/course', 'AI Agent Builder'],
  ['/exam/', 'Exam'],
  ['/app', 'Study with Sarah'],
  ['/', 'Conversational Certification Prep'],
];

function RouteAccessibility() {
  const [location] = useLocation();

  useEffect(() => {
    const pageName = ROUTE_TITLES.find(([prefix]) =>
      prefix === '/' ? location === '/' : location.startsWith(prefix),
    )?.[1] ?? 'Page';
    document.title = `${pageName} — CertEfficiency`;
    document.getElementById('main-content')?.focus({ preventScroll: true });
  }, [location]);

  return null;
}

function PageFallback() {
  return (
    <div className="min-h-screen grid place-items-center" role="status" aria-live="polite">
      <span className="sr-only">Loading page</span>
      <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" aria-hidden="true" />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Global 401 handler
//
// When any query returns 401 (expired / invalid token), clear the stale token
// from localStorage and redirect to the login page.  This prevents users from
// being stuck in a broken UI state where all API calls silently fail.
//
// This must NOT redirect when the user is already on an auth page, or it
// would create an infinite redirect loop (login → 401 on auth/me check → login).
// ---------------------------------------------------------------------------
function handleGlobalQueryError(error: unknown): void {
  if (error instanceof ApiError && error.status === 401) {
    if (typeof localStorage !== 'undefined') {
      localStorage.removeItem('certefficiency_token');
    }
    const path = window.location.pathname;
    if (!path.startsWith('/auth/')) {
      window.location.href = '/auth/login';
    }
  }
}

const queryClient = new QueryClient({
  queryCache: new QueryCache({ onError: handleGlobalQueryError }),
  defaultOptions: {
    queries: {
      // Never retry on 401 — the token is definitively invalid; redirect instead.
      retry: (failureCount, error) => {
        if (error instanceof ApiError && error.status === 401) return false;
        return failureCount < 1;
      },
      refetchOnWindowFocus: false,
    },
  },
});

function Router() {
  return (
    <Suspense fallback={<PageFallback />}>
      <Switch>
        <Route path="/" component={Landing} />
        <Route path="/app" component={Home} />
        <Route path="/auth/login" component={Login} />
        <Route path="/auth/register" component={Register} />
        <Route path="/auth/forgot-password" component={ForgotPassword} />
        <Route path="/auth/reset-password" component={ResetPassword} />
        <Route path="/settings" component={Settings} />
        <Route path="/exam/:id/results">{(params) => <ExamResults params={params} />}</Route>
        <Route path="/exam/:id">{(params) => <Exam params={params} />}</Route>
        <Route path="/video-course" component={VideoCourse} />
        <Route path="/course/success" component={CourseSuccess} />
        <Route path="/course" component={AiCourse} />
        <Route component={NotFound} />
      </Switch>
    </Suspense>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, '')}>
          <a className="skip-link" href="#main-content">Skip to main content</a>
          <RouteAccessibility />
          <div id="main-content" tabIndex={-1} className="focus:outline-none">
            <Router />
          </div>
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;

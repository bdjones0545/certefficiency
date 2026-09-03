import { QueryClient, QueryCache, QueryClientProvider } from '@tanstack/react-query';
import { ApiError } from '@workspace/api-client-react';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import NotFound from '@/pages/not-found';
import { Route, Switch, Router as WouterRouter } from 'wouter';
import Landing from './pages/landing';
import Home from './pages/home';
import Login from './pages/auth/login';
import Register from './pages/auth/register';
import ForgotPassword from './pages/auth/forgot-password';
import ResetPassword from './pages/auth/reset-password';
import Settings from './pages/settings';
import Exam from './pages/exam';
import ExamResults from './pages/exam/results';
import VideoCourse from './pages/video-course';
import AiCourse from './pages/ai-course';
import CourseSuccess from './pages/course-success';

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
    <Switch>
      <Route path="/" component={Landing} />
      <Route path="/app" component={Home} />
      <Route path="/auth/login" component={Login} />
      <Route path="/auth/register" component={Register} />
      <Route path="/auth/forgot-password" component={ForgotPassword} />
      <Route path="/auth/reset-password" component={ResetPassword} />
      <Route path="/settings" component={Settings} />
      <Route path="/exam/:id">{(params) => <Exam params={params} />}</Route>
      <Route path="/exam/:id/results">{(params) => <ExamResults params={params} />}</Route>
      <Route path="/video-course" component={VideoCourse} />
      <Route path="/course/success" component={CourseSuccess} />
      <Route path="/course" component={AiCourse} />
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, '')}>
          <Router />
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;

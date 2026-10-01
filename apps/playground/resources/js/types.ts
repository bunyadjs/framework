export type AuthUser = {
  id: number | string;
  name: string;
  email: string;
};

export type SharedProps = {
  appName: string;
  csrf: string;
  auth: {
    user: AuthUser | null;
  };
  flash: {
    status?: string | null;
    error?: string | null;
  };
  errors: Record<string, string[]>;
};

export type LoginPageProps = SharedProps & {
  email?: string;
};

export type RegisterPageProps = SharedProps;

export type DashboardPageProps = SharedProps & {
  name: string;
};

export type WelcomePageProps = SharedProps & {
  title: string;
  message: string;
};

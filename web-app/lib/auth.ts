export const USER_ID_KEY = "kakao_user_id";
export const IS_ADMIN_KEY = "is_admin";

export function getUserId(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(USER_ID_KEY);
}

export function isAdmin(): boolean {
  if (typeof window === "undefined") return false;
  return localStorage.getItem(IS_ADMIN_KEY) === "true";
}

export function loginAsAdmin(): void {
  localStorage.setItem(USER_ID_KEY, "__admin__");
  localStorage.setItem(IS_ADMIN_KEY, "true");
}

export function loginAsUser(userId: string): void {
  localStorage.setItem(USER_ID_KEY, userId);
  localStorage.setItem(IS_ADMIN_KEY, "false");
}

export function logout(): void {
  localStorage.removeItem(USER_ID_KEY);
  localStorage.removeItem(IS_ADMIN_KEY);
}

export function isLoggedIn(): boolean {
  return getUserId() !== null;
}

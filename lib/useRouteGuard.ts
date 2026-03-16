/**
 * DEPRECATED: Route guards are now centralized in ProtectedLayout via resolveAccess()
 * 
 * This hook is kept for backward compatibility but does NOT perform redirects.
 * All access decisions are made in ProtectedLayout using resolveAccess().
 * 
 * If you need to check access in a component, use resolveAccess() directly
 * and handle the result appropriately (but do NOT redirect - let ProtectedLayout handle it).
 */
export function useRouteGuard() {
  // NO-OP: Access control is now centralized in ProtectedLayout
  // This hook exists for backward compatibility only
  // Components using this hook will have access controlled by ProtectedLayout
}













/**
 * @hauddy/app-shared — the platform (network hub) dashboard: a real client for
 * the hub control API + the screens that render it, consumed by the platform
 * web app (@hauddy/web). Styles live in `@hauddy/app-shared/styles.css` and
 * assume `@hauddy/web-tokens` is imported first.
 */

export {
  api,
  configureApi,
  friendHuman,
  useApiData,
  useApiState,
  useAuthed,
  normalizeNickname,
  signup,
  login,
  revealKey,
  getKey,
  clearKey,
  isAuthed,
} from './api';
export type {
  Api,
  ApiState,
  Attachment,
  FriendAccount,
  LinkedFriend,
  FriendsView,
  ConsoleMessage,
  ConsoleCallFrame,
  ConsoleCallPoll,
  ThreadSummary,
  ThreadMessage,
  CallLogEntry,
  Notifications,
} from './api';
export type {
  AccountKey,
  Agent,
  Contact,
  ContactActionResult,
  Nickname,
  NicknameOutcome,
  PendingContact,
  Presence as PresenceState,
  UserProfile,
} from './api/types';

export { default as Logo } from './components/Logo';
export { default as Presence, PresenceDot } from './components/Presence';
export { default as Combobox } from './components/Combobox';
export type { ComboItem } from './components/Combobox';
export { default as EmptyState } from './components/EmptyState';
export type { EmptyStateProps } from './components/EmptyState';
export { default as ErrorState } from './components/ErrorState';
export type { ErrorStateProps } from './components/ErrorState';
export { default as LoadingSkeleton, SkeletonRow, SkeletonCard, SkeletonList, SkeletonText } from './components/LoadingSkeleton';

export { PlatformPathsProvider, usePlatformPaths, makePlatformPaths } from './paths';
export type { PlatformPaths } from './paths';

export { default as Agents } from './screens/Agents';
export { default as AgentPage } from './screens/AgentPage';
export { default as Contacts } from './screens/Contacts';
export { default as FriendProfile } from './screens/FriendProfile';
export { default as Messages } from './screens/Messages';
export { default as Account } from './screens/Account';
export type { AccountProps } from './screens/Account';
export { default as Settings } from './screens/Settings';

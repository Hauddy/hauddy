/**
 * @hauddy/app-shared — the platform (network hub) dashboard: a real client for
 * the hub control API + the screens that render it, consumed by the platform
 * web app (@hauddy/web). Styles live in `@hauddy/app-shared/styles.css` and
 * assume `@hauddy/web-tokens` is imported first.
 */

export {
  api,
  configureApi,
  useApiData,
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

export { PlatformPathsProvider, usePlatformPaths, makePlatformPaths } from './paths';
export type { PlatformPaths } from './paths';

export { default as Home } from './screens/Home';
export { default as Nicknames } from './screens/Nicknames';
export { default as Contacts } from './screens/Contacts';
export { default as Messages } from './screens/Messages';
export { default as Account } from './screens/Account';
export type { AccountProps } from './screens/Account';

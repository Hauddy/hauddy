/** 16px stroke icons for the nav rail. Inherit `currentColor`. */

interface IconProps {
  size?: number;
}

function base(props: IconProps) {
  return {
    width: props.size ?? 16,
    height: props.size ?? 16,
    viewBox: '0 0 16 16',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.5,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    'aria-hidden': true,
  };
}

export function IconAgents(props: IconProps) {
  return (
    <svg {...base(props)}>
      <rect x="2.5" y="4.5" width="11" height="8" rx="2" />
      <path d="M6 8.5h.01M10 8.5h.01" strokeWidth={2.2} />
      <path d="M8 4.5V2.5M8 2.5h3" />
    </svg>
  );
}

export function IconActivity(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M2 8.5h2.5L6 4l2.5 8L10 8h4" />
    </svg>
  );
}

export function IconContacts(props: IconProps) {
  return (
    <svg {...base(props)}>
      <circle cx="4" cy="9.5" r="2" />
      <circle cx="12" cy="9.5" r="2" />
      <path d="M5.4 7.9Q8 4.8 10.6 7.9" />
    </svg>
  );
}

export function IconMessages(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M2.5 4.5a1 1 0 0 1 1-1h9a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1H6l-2.5 2v-2h-0a1 1 0 0 1-1-1Z" />
    </svg>
  );
}

export function IconPlatform(props: IconProps) {
  return (
    <svg {...base(props)}>
      <circle cx="8" cy="8" r="5.5" />
      <path d="M2.5 8h11M8 2.5c1.6 1.5 2.5 3.4 2.5 5.5S9.6 12 8 13.5C6.4 12 5.5 10.1 5.5 8S6.4 4 8 2.5Z" />
    </svg>
  );
}

export function IconSearch(props: IconProps) {
  return (
    <svg {...base(props)}>
      <circle cx="7" cy="7" r="4" />
      <path d="M10 10l3.5 3.5" />
    </svg>
  );
}

export function IconTrash(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.6 8a1 1 0 0 0 1 .9h3.8a1 1 0 0 0 1-.9l.6-8" />
    </svg>
  );
}

export function IconSend(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M13.5 2.5 7 9M13.5 2.5l-4 11-2.5-4.5L2 6.5l11.5-4Z" />
    </svg>
  );
}

export function IconPlus(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M8 3.5v9M3.5 8h9" />
    </svg>
  );
}

export function IconSettings(props: IconProps) {
  return (
    <svg {...base(props)}>
      <circle cx="8" cy="8" r="2.5" />
      <path d="M8 2v1.5M8 12.5V14M2 8h1.5M12.5 8H14M3.75 3.75l1.06 1.06M11.19 11.19l1.06 1.06M3.75 12.25l1.06-1.06M11.19 4.81l1.06-1.06" />
    </svg>
  );
}

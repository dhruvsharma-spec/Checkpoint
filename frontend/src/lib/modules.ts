// The sidebar is built from this list. A module is a section: its own page is the section itself, and the pages inside
// it are listed under it. A new feature gets its own section by adding an entry here.
export type SubPage = { label: string; href: string; match: (path: string) => boolean; adminOnly?: boolean };
export type Module = { label: string; href: string; icon: string; isHome: (path: string) => boolean; items: SubPage[]; showQueue?: boolean };

const CCB_OTHER = ['/ccb/calendar', '/ccb/approvers'];

export const MODULES: Module[] = [
  {
    label: 'Home', href: '/', icon: 'M3 10.5 12 3l9 7.5V21a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1z',
    isHome: (p) => p === '/',
    items: [],
  },
  {
    label: 'CCB', href: '/ccb', icon: 'M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z M14 3v5h5 M9 13h6 M9 17h6',
    isHome: (p) => p === '/ccb' || (p.startsWith('/ccb/') && !CCB_OTHER.includes(p)),
    showQueue: true,
    items: [
      { label: 'Calendar', href: '/ccb/calendar', match: (p) => p === '/ccb/calendar' },
      { label: 'Approval matrix', href: '/ccb/approvers', match: (p) => p === '/ccb/approvers', adminOnly: true },
    ],
  },
  {
    label: 'Activities', href: '/activities', icon: 'M8 7h8 M8 12h8 M8 17h5 M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z',
    isHome: (p) => p === '/activities' || p.startsWith('/activities/'),
    items: [],
  },
];

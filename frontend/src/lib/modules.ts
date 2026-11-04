// The sidebar is built from this list. A module is a section: its own page is the section itself, and the pages inside
// it are listed under it. A new feature gets its own section by adding an entry here.
export type SubPage = { label: string; href: string; match: (path: string) => boolean; adminOnly?: boolean };
export type Module = { label: string; href: string; icon: string; isHome: (path: string) => boolean; items: SubPage[] };

const CCB_OTHER = ['/ccb/calendar', '/ccb/approvers'];

export const MODULES: Module[] = [
  {
    label: 'CCB', href: '/ccb', icon: 'M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z M14 3v5h5 M9 13h6 M9 17h6',
    // The CCB page itself also covers opening one CCB and filing a new one, and it is where signing in lands.
    isHome: (p) => p === '/' || p === '/ccb' || (p.startsWith('/ccb/') && !CCB_OTHER.includes(p)),
    items: [
      { label: 'Calendar', href: '/ccb/calendar', match: (p) => p === '/ccb/calendar' },
      { label: 'Approval matrix', href: '/ccb/approvers', match: (p) => p === '/ccb/approvers', adminOnly: true },
    ],
  },
];

/**
 * Les quatre repères de réponse. La forme double la couleur : le repérage reste
 * possible en cas de daltonisme, et à distance sur un vidéoprojecteur.
 */
export const FORMES = [
  { nom: 'triangle', svg: '<svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M8 1.6l6.4 12.8H1.6z"/></svg>' },
  { nom: 'losange',  svg: '<svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M8 1l7 7-7 7-7-7z"/></svg>' },
  { nom: 'cercle',   svg: '<svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><circle cx="8" cy="8" r="6.6"/></svg>' },
  { nom: 'carré',    svg: '<svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><rect x="1.8" y="1.8" width="12.4" height="12.4" rx="2"/></svg>' },
];

export const forme = (i) => FORMES[i % FORMES.length];

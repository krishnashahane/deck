/** ECMA-376 namespaces and relationship types used by the presentation package. */
export const NS = {
  a: 'http://schemas.openxmlformats.org/drawingml/2006/main',
  p: 'http://schemas.openxmlformats.org/presentationml/2006/main',
  r: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships',
  c: 'http://schemas.openxmlformats.org/drawingml/2006/chart',
  p14: 'http://schemas.microsoft.com/office/powerpoint/2010/main',
  rel: 'http://schemas.openxmlformats.org/package/2006/relationships',
  ct: 'http://schemas.openxmlformats.org/package/2006/content-types',
};

const OD = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
export const REL = {
  officeDocument: `${OD}/officeDocument`,
  slide: `${OD}/slide`,
  slideLayout: `${OD}/slideLayout`,
  slideMaster: `${OD}/slideMaster`,
  theme: `${OD}/theme`,
  notesSlide: `${OD}/notesSlide`,
  notesMaster: `${OD}/notesMaster`,
  image: `${OD}/image`,
  video: `${OD}/video`,
  audio: `${OD}/audio`,
  media: 'http://schemas.microsoft.com/office/2007/relationships/media',
  chart: `${OD}/chart`,
  hyperlink: `${OD}/hyperlink`,
  presProps: `${OD}/presProps`,
  viewProps: `${OD}/viewProps`,
  tableStyles: `${OD}/tableStyles`,
  coreProps: 'http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties',
  extProps: `${OD}/extended-properties`,
  vbaProject: 'http://schemas.microsoft.com/office/2006/relationships/vbaProject',
  oleObject: `${OD}/oleObject`,
  diagramData: `${OD}/diagramData`,
};

export const CT = {
  presentation: 'application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml',
  macroPresentation: 'application/vnd.ms-powerpoint.presentation.macroEnabled.main+xml',
  slide: 'application/vnd.openxmlformats-officedocument.presentationml.slide+xml',
  slideLayout: 'application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml',
  slideMaster: 'application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml',
  notesSlide: 'application/vnd.openxmlformats-officedocument.presentationml.notesSlide+xml',
  notesMaster: 'application/vnd.openxmlformats-officedocument.presentationml.notesMaster+xml',
  theme: 'application/vnd.openxmlformats-officedocument.theme+xml',
  chart: 'application/vnd.openxmlformats-officedocument.drawingml.chart+xml',
  presProps: 'application/vnd.openxmlformats-officedocument.presentationml.presProps+xml',
  viewProps: 'application/vnd.openxmlformats-officedocument.presentationml.viewProps+xml',
  tableStyles: 'application/vnd.openxmlformats-officedocument.presentationml.tableStyles+xml',
  core: 'application/vnd.openxmlformats-package.core-properties+xml',
  app: 'application/vnd.openxmlformats-officedocument.extended-properties+xml',
  rels: 'application/vnd.openxmlformats-package.relationships+xml',
};

/** Extension list URI for slide sections (p14:sectionLst). */
export const SECTION_EXT_URI = '{521415D9-36F7-43E2-AB2F-B90AF26B5E84}';
/** Extension list URI for embedded media (p14:media). */
export const MEDIA_EXT_URI = '{DAA4B4D4-6D71-4841-9C94-3DA1C2E3F1B5}';

export const EMU = 9525; // per slide unit
export const ANGLE = 60000; // per degree

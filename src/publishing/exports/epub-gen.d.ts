declare module 'epub-gen' {
  interface EpubChapter {
    title?: string;
    data: string;
    filename?: string;
    excludeFromToc?: boolean;
  }

  interface EpubOptions {
    title: string;
    author: string | string[];
    publisher?: string;
    lang?: string;
    tocTitle?: string;
    version?: 2 | 3;
    css?: string;
    tempDir?: string;
    content: EpubChapter[];
  }

  class Epub {
    readonly promise: Promise<void>;
    constructor(options: EpubOptions, output?: string);
  }

  export = Epub;
}

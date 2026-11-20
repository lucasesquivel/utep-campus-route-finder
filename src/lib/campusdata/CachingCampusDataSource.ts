import type { CampusDataSource } from './CampusDataSource';

export class CachingCampusDataSource implements CampusDataSource {
  private cachedLoad?: ReturnType<CampusDataSource['load']>;

  constructor(private readonly source: CampusDataSource) {}

  load(): ReturnType<CampusDataSource['load']> {
    if (!this.cachedLoad) {
      this.cachedLoad = this.source.load().catch((error: unknown) => {
        this.cachedLoad = undefined;
        throw error;
      });
    }

    return this.cachedLoad;
  }
}

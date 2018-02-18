# Introduction

This package provides a [leveldown](https://github.com/Level/leveldown) compatible interface with [node-lmdb](https://github.com/Venemo/node-lmdb).

# Usage

The most simple usage works the same as the LevelDB implementation of Leveldown.
```javascript
import leveldown from 'lmdb-leveldown';
const db = levelup(leveldown('path/to/db'));
```

There are additional options that may optionally be supplied.
```javascript
import leveldown from 'lmdb-leveldown';
const db = levelup(leveldown('path/to/db'), {
  mapSize: 2 * 1024 * 1024 * 1024,
});
```

The full type signature for the options type is as follows.
```javascript
type OptionsType = {
  mapSize?: number,
  dbiName?: string,
  createIfMissing?: boolean,
  errorIfExists?: boolean,
  asBuffer?: boolean,
  env?: EnvType,
  dbi?: DbiType,
};
```

Each options does the following:
* mapSize: The maximum database size passed to LMDB. This defaults to 2GB
* dbiName: The LMDB dbi name
* createIfMissing: Creates both the file path and database if either doesn't exist
* errorIfExists: Throws on attempts to open the database if it already exists
* asBuffer: db.get() will return a utf8 encoded buffer 
* env: An existing node-lmdb environment to use in place of creating a new one
* dbi: An existing node-lmdb dbi to use in place of creating a new one. env is required if dbi is supplied.

It's important to note that because env and dbi are overriding the defaults, some parameters are not used when they are supplied.
* env: overrides database path and ``mapSize``
* dbi: overrides ``dbiName``

# Development

Before submitting a PR, make sure that you run the code through prettier with ``npm run prettify`` and ensure that ``npm run validate`` passes.

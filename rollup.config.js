// @flow

import config from 'chrbala-rollup';
export default Object.assign({}, config, {
	external: ['abstract-leveldown', 'node-lmdb', 'mkdirp', 'fs'],
});

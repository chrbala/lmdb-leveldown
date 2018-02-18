// @flow

const createLinter = require('chrbala-linter');
const linter = createLinter({ modules: ['eslint', 'flow'] });
module.exports = linter;

// @flow

import test from 'tape';
import leveldown from '..';
import abstract from 'abstract-leveldown/abstract/close-test';
import testCommon from 'abstract-leveldown/testCommon';

module.exports.setUp = function() {
	test('setUp', testCommon.setUp);
};

module.exports.close = abstract.close;

module.exports.tearDown = function() {
	test('tearDown', testCommon.tearDown);
};

module.exports.all = function(ld: *) {
	module.exports.setUp();
	module.exports.close(ld, test, testCommon);
	module.exports.tearDown();
};

module.exports.all(leveldown);

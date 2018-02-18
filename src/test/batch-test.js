// @flow

import test from 'tape';
import leveldown from '..';
import abstract from 'abstract-leveldown/abstract/batch-test';

abstract.all(leveldown, test);

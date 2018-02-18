// @flow

import test from 'tape';
import leveldown from '..';
import abstract from 'abstract-leveldown/abstract/chained-batch-test';

abstract.all(leveldown, test);

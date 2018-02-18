// @flow

import {
	AbstractLevelDOWN,
	AbstractIterator,
	AbstractChainedBatch,
} from 'abstract-leveldown';
import { Env, Cursor } from 'node-lmdb';
import mkdirp from 'mkdirp';
import { existsSync } from 'fs';

opaque type EnvType = { [key: string]: * };
opaque type DbiType = { [key: string]: * };
opaque type TransactionType = { [key: string]: * };
opaque type CursorType = typeof Cursor;
opaque type CurrentCursorValueType = { [key: string]: * };
type LocationType = string;
type KeyType = string | Buffer;
type ValueType = string | boolean | number | Buffer;
type OptionsType = {
	mapSize?: number,
	dbiName?: string,
	createIfMissing?: boolean,
	errorIfExists?: boolean,
	asBuffer?: boolean,
	env?: EnvType,
	dbi?: DbiType,
};
type LegacyIteratorOptionsType = {
	start?: ?string,
	end?: ?string,
};
type IteratorOptionsType = {
	gt?: ?string,
	gte?: ?string,
	lt?: ?string,
	lte?: ?string,
	reverse?: ?boolean,
	keyAsBuffer?: ?boolean,
	valueAsBuffer?: ?boolean,
	limit?: ?number,
};

type CallbackArgsType =
	| []
	| [null, ValueType]
	| [null, KeyType, ValueType]
	| [Error];
type CallbackType = (...args: CallbackArgsType) => mixed;

const DELETE: 'del' = 'del';
const PUT: 'put' = 'put';
type OpType =
	| { type: typeof PUT, key: KeyType, value: ValueType }
	| { type: typeof DELETE, key: KeyType };

const serialize = (value: Buffer | string) =>
	typeof value === 'string'
		? Buffer.from(value, 'utf16le')
		: Buffer.from(value.toString(), 'utf16le');
const deserialize = (value: Buffer) =>
	value.toString('utf16le').replace(/\0$/, '');

type PutArgType = {
	env: EnvType,
	dbi: DbiType,
	ops: Array<OpType>,
	callback: CallbackType,
};
const commit = ({ env, dbi, ops, callback }: PutArgType) => {
	let _txn: ?TransactionType;
	try {
		const txn = (_txn = env.beginTxn());
		ops.forEach(op => {
			if (op.type === PUT) {
				const { key, value } = op;
				const putValue =
					typeof value === 'string'
						? txn.putString
						: typeof value === 'number'
							? txn.putNumber
							: typeof value === 'boolean'
								? txn.putBoolean
								: // eslint-disable-next-line max-params
								function(d, k, _, options) {
									this.putBinary(d, k, serialize(value), options);
								};
				putValue.call(txn, dbi, key, value, {
					keyIsBuffer: Buffer.isBuffer(key),
				});
			} else if (op.type === DELETE) {
				const { key } = op;
				if (txn.getBinary(dbi, key) !== null)
					txn.del(dbi, key, { keyIsBuffer: Buffer.isBuffer(key) });
			}
		});
		txn.commit();
		env.sync(e => (e ? callback(new Error(e)) : callback()));
	} catch (e) {
		if (_txn)
			try {
				_txn.abort();
			} catch (error) {}
		process.nextTick(() => callback(new Error(e)));
	}
};

class Batch extends AbstractChainedBatch {
	env: EnvType;
	dbi: DbiType;
	ops: Array<OpType>;

	// eslint-disable-next-line no-use-before-define
	constructor(db: LevelDOWN, env: EnvType, dbi: DbiType) {
		super(db);
		this.ops = [];
		this.env = env;
		this.dbi = dbi;
	}

	_put(key: KeyType, value: ValueType) {
		const { ops } = this;
		ops.push({ type: PUT, key, value });
	}

	_del(key: KeyType) {
		const { ops } = this;
		ops.push({ type: DELETE, key });
	}

	_clear() {
		this.ops = [];
	}

	_write(callback: CallbackType) {
		const { env, dbi, ops } = this;
		commit({
			env,
			dbi,
			ops,
			callback,
		});
	}
}

type GoToArgType = {
	key: string,
	cursor: CursorType,
	txn: TransactionType,
	dbi: DbiType,
};
const goTo = ({ key, cursor, txn, dbi }: GoToArgType) => {
	const init = () => {
		txn.putBoolean(dbi, key, true);
		cursor.goToKey(key);
	};

	const gt = () => {
		const curr = cursor.goToKey(key);
		if (!curr) {
			init();
			return cursor.goToNext();
		}

		return cursor.goToNext();
	};
	const gte = () => {
		const curr = cursor.goToKey(key);
		if (!curr) {
			init();
			return cursor.goToNext();
		}

		return curr;
	};
	const lt = () => {
		const curr = cursor.goToKey(key);
		if (!curr) {
			init();
			return cursor.goToPrev();
		}

		return cursor.goToPrev();
	};
	const lte = () => {
		const curr = cursor.goToKey(key);
		if (!curr) {
			init();
			return cursor.goToPrev();
		}

		return curr;
	};
	return {
		gt,
		gte,
		lt,
		lte,
	};
};

type GetInitialCurrentValueContextType = {
	cursor: CursorType,
	txn: TransactionType,
	dbi: DbiType,
};
const getInitialCurrentValue = (
	{ gt, gte, lt, lte, reverse }: IteratorOptionsType,
	{ cursor, txn, dbi }: GetInitialCurrentValueContextType
) => {
	const boundGoto = key => goTo({ key, cursor, txn, dbi });
	const invalid = (a: string, b: string) =>
		`${a} can not be provided with ${b}`;

	if (gt && gte) throw new Error(invalid('gt', 'gte'));
	if (lt && lte) throw new Error(invalid('lt', 'lte'));

	return gt
		? reverse
			? lt ? boundGoto(lt).lt() : lte ? boundGoto(lte).lte() : cursor.goToLast()
			: boundGoto(gt).gt()
		: gte
			? reverse
				? lt
					? boundGoto(lt).lt()
					: lte ? boundGoto(lte).lte() : cursor.goToLast()
				: boundGoto(gte).gte()
			: lt
				? reverse ? boundGoto(lt).lt() : cursor.goToFirst()
				: lte
					? reverse ? boundGoto(lte).lte() : cursor.goToFirst()
					: reverse ? cursor.goToLast() : cursor.goToFirst();
};

type HasMoreArgType = {
	options: IteratorOptionsType,
	key: string,
	count: number,
};
const hasMore = ({
	options: { gt, gte, lt, lte, limit },
	key,
	count,
}: HasMoreArgType) => {
	if (typeof limit == 'number') {
		if (limit == 0) return false;
		if (limit >= 0 && count >= limit) return false;
	}
	if (gt && key <= gt) return false;
	if (gte && key < gte) return false;
	if (lt && key >= lt) return false;
	if (lte && key > lte) return false;

	return true;
};

const fromLegacyIteratorOptions = ({
	reverse,
	start,
	end,
	gt,
	gte,
	lt,
	lte,
	keyAsBuffer,
	valueAsBuffer,
	limit,
}: IteratorOptionsType & LegacyIteratorOptionsType): IteratorOptionsType => ({
	reverse,
	gt,
	gte: gte || (reverse ? end : start),
	lt,
	lte: lte || (reverse ? start : end),
	keyAsBuffer,
	valueAsBuffer,
	limit,
});
class Iterator extends AbstractIterator {
	env: EnvType;
	dbi: DbiType;
	options: IteratorOptionsType;
	txn: TransactionType;
	cursor: CursorType;
	curr: CurrentCursorValueType;

	// eslint-disable-next-line max-params
	constructor(
		// eslint-disable-next-line no-use-before-define
		db: LevelDOWN,
		env: EnvType,
		dbi: DbiType,
		options: IteratorOptionsType
	) {
		super(db);
		this.env = env;
		this.options = options;
		const txn = (this.txn = env.beginTxn());
		const cursor = (this.cursor = new Cursor(txn, dbi, {}));
		this.curr = getInitialCurrentValue(options, { cursor, dbi, txn });
		this.count = 0;
	}

	async _next(callback: CallbackType) {
		const {
			cursor,
			curr,
			options,
			options: { reverse, keyAsBuffer, valueAsBuffer },
		} = this;
		try {
			const { count } = this;
			if (curr) {
				const { key, value } = await new Promise((resolve, reject) => {
					try {
						cursor.getCurrentBinary((k, v) => resolve({ key: k, value: v }));
					} catch (e) {
						reject(new Error(e));
					}
				});

				this.curr = reverse ? cursor.goToPrev() : cursor.goToNext();

				const wrapKey = k => (keyAsBuffer ? Buffer.from(k) : k);
				const wrapValue = v => (valueAsBuffer ? Buffer.from(v) : v);
				if (hasMore({ options, key: deserialize(key), count }))
					process.nextTick(() => {
						this.count++;
						callback(
							null,
							wrapKey(deserialize(key)),
							wrapValue(deserialize(value))
						);
					});
				else process.nextTick(callback);
			} else process.nextTick(callback);
		} catch (e) {
			process.nextTick(() => callback(new Error(e)));
		}
	}

	_end(callback: CallbackType) {
		const { txn, env, cursor } = this;
		try {
			cursor.close();
			txn.abort();
			env.sync(e => (e ? callback(new Error(e)) : callback()));
		} catch (e) {
			try {
				txn.abort();
			} catch (error) {}
			process.nextTick(() => callback(new Error(e)));
		}
	}
}

class LevelDOWN extends AbstractLevelDOWN {
	env: EnvType;
	dbi: DbiType;
	path: string;

	constructor(location: LocationType) {
		super(location);
		this.path = location;
	}

	_open(
		{
			mapSize,
			createIfMissing,
			errorIfExists,
			dbiName,
			...overrides
		}: OptionsType,
		callback: CallbackType
	) {
		try {
			const { path } = this;

			if (overrides.dbi && !overrides.env)
				throw new Error('env must be supplied with dbi');

			if (errorIfExists && existsSync(path))
				throw new Error('File already exists');

			if (createIfMissing !== false) mkdirp.sync(path);

			const env = (this.env =
				overrides.env ||
				(() => {
					const _env = new Env();

					_env.open({
						mapSize: mapSize !== undefined ? mapSize : 2 * 1024 * 1024 * 1024,
						maxDbs: 1,
						path,
					});

					return _env;
				})());

			this.dbi =
				env.dbi ||
				env.openDbi({
					name: dbiName,
					create: createIfMissing !== false,
					noMetaSync: true,
					noSync: true,
				});
			process.nextTick(callback);
		} catch (e) {
			const error = e.message.match(/(file|directory)/)
				? Object.assign(e, { message: 'file or directory does not exist' })
				: e;
			process.nextTick(() => callback(new Error(error)));
		}
	}

	_close(callback: CallbackType) {
		try {
			const { env, dbi } = this;
			dbi.close();
			env.close();
			process.nextTick(callback);
		} catch (e) {
			process.nextTick(() => callback(new Error(e)));
		}
	}

	// eslint-disable-next-line max-params
	_put(
		key: KeyType,
		value: ValueType,
		options: OptionsType,
		callback: CallbackType
	) {
		const { env, dbi } = this;
		const ops = [{ type: PUT, key, value }];
		commit({
			env,
			dbi,
			ops,
			callback,
		});
	}

	_get(key: KeyType, { asBuffer }: OptionsType, callback: CallbackType) {
		const { env, dbi } = this;
		const txn: TransactionType = env.beginTxn();
		try {
			const maybeBuffer = txn.getBinary(dbi, key, {
				keyIsBuffer: Buffer.isBuffer(key),
			});

			if (maybeBuffer === null) throw new Error('NotFound');
			const buffer = maybeBuffer === undefined ? serialize('') : maybeBuffer;

			const data = deserialize(buffer);
			txn.commit();
			env.sync(e => {
				if (e) callback(new Error(e));
				else callback(null, asBuffer ? Buffer.from(data) : data);
			});
		} catch (e) {
			if (txn)
				try {
					txn.abort();
				} catch (error) {}
			process.nextTick(() => callback(new Error(e)));
		}
	}

	_del(key: KeyType, options: OptionsType, callback: CallbackType) {
		const { env, dbi } = this;
		const ops = [{ type: DELETE, key }];
		commit({
			env,
			dbi,
			ops,
			callback,
		});
	}

	_batch(array: Array<OpType>, options: OptionsType, callback: CallbackType) {
		const { env, dbi } = this;
		commit({
			env,
			dbi,
			ops: array,
			callback,
		});
	}

	_iterator(options: IteratorOptionsType & LegacyIteratorOptionsType) {
		const { env, dbi } = this;
		return new Iterator(this, env, dbi, fromLegacyIteratorOptions(options));
	}

	_chainedBatch() {
		const { env, dbi } = this;
		return new Batch(this, env, dbi);
	}
}

export default (location: string) => new LevelDOWN(location);

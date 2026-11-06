import { describe, expect, it } from 'vitest';
import { MinPriorityQueue } from './MinPriorityQueue';

describe('MinPriorityQueue', () => {
	it('starts empty', () => {
		const q = new MinPriorityQueue<number>((a, b) => a - b);
		expect(q.isEmpty()).toBe(true);
		expect(q.size).toBe(0);
		expect(q.peek()).toBeUndefined();
		expect(q.pop()).toBeUndefined();
	});

	it('pops items in ascending order', () => {
		const q = new MinPriorityQueue<number>((a, b) => a - b);
		for (const n of [5, 3, 8, 1, 9, 2, 7]) q.push(n);
		expect(q.size).toBe(7);
		expect(q.peek()).toBe(1);
		const out: number[] = [];
		while (!q.isEmpty()) out.push(q.pop() as number);
		expect(out).toEqual([1, 2, 3, 5, 7, 8, 9]);
	});

	it('keeps duplicates', () => {
		const q = new MinPriorityQueue<number>((a, b) => a - b);
		[2, 1, 2, 1].forEach((n) => q.push(n));
		expect([q.pop(), q.pop(), q.pop(), q.pop()]).toEqual([1, 1, 2, 2]);
	});

	it('sorts random input like Array.sort', () => {
		let seed = 42;
		const rand = () => ((seed = (seed * 1_103_515_245 + 12_345) % 2 ** 31) / 2 ** 31) * 1000;
		const values = Array.from({ length: 500 }, rand);
		const q = new MinPriorityQueue<number>((a, b) => a - b);
		values.forEach((v) => q.push(v));
		const out: number[] = [];
		while (!q.isEmpty()) out.push(q.pop() as number);
		expect(out).toEqual([...values].sort((a, b) => a - b));
	});

	it('honours a multi-key comparator', () => {
		type E = { f: number; id: string };
		const q = new MinPriorityQueue<E>((a, b) => a.f - b.f || a.id.localeCompare(b.id));
		q.push({ f: 1, id: 'b' });
		q.push({ f: 0, id: 'z' });
		q.push({ f: 1, id: 'a' });
		expect([q.pop()?.id, q.pop()?.id, q.pop()?.id]).toEqual(['z', 'a', 'b']);
	});
});

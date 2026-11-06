/**
 * Binary min-heap ordered by a caller-supplied comparator. Internal data structure for the
 * RouteEngine A* search (SDD 5.2 comments); it has no domain responsibility.
 *
 * compare(a, b) < 0 means a has higher priority (is popped before) b.
 */
export class MinPriorityQueue<T> {
	private readonly heap: T[] = [];
	private readonly compare: (a: T, b: T) => number;

	constructor(compare: (a: T, b: T) => number) {
		this.compare = compare;
	}

	get size(): number {
		return this.heap.length;
	}

	isEmpty(): boolean {
		return this.heap.length === 0;
	}

	/** Smallest item without removing it, or undefined when empty. */
	peek(): T | undefined {
		return this.heap[0];
	}

	/** Adds an item. O(log n). */
	push(item: T): void {
		this.heap.push(item);
		this.siftUp(this.heap.length - 1);
	}

	/** Removes and returns the smallest item, or undefined when empty. O(log n). */
	pop(): T | undefined {
		const heap = this.heap;
		if (heap.length === 0) return undefined;
		const top = heap[0];
		// Safe: heap is non-empty here, so pop() returns an element (T may itself include undefined).
		const last = heap.pop() as T;
		if (heap.length > 0) {
			heap[0] = last;
			this.siftDown(0);
		}
		return top;
	}

	private siftUp(index: number): void {
		const heap = this.heap;
		const item = heap[index];
		while (index > 0) {
			const parent = (index - 1) >> 1;
			if (this.compare(item, heap[parent]) >= 0) break;
			heap[index] = heap[parent];
			index = parent;
		}
		heap[index] = item;
	}

	private siftDown(index: number): void {
		const heap = this.heap;
		const length = heap.length;
		const item = heap[index];
		for (;;) {
			const left = 2 * index + 1;
			if (left >= length) break;
			const right = left + 1;
			const child = right < length && this.compare(heap[right], heap[left]) < 0 ? right : left;
			if (this.compare(heap[child], item) >= 0) break;
			heap[index] = heap[child];
			index = child;
		}
		heap[index] = item;
	}
}

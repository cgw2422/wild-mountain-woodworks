"use client";

import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  rectSortingStrategy,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { cn } from "@/lib/cn";

/**
 * Generic sortable list/grid. Items can be reordered by dragging the handle,
 * with the keyboard (focus the handle, Space, arrows, Space), or with the
 * explicit move buttons rendered by `renderItem`.
 */
export function SortableList<T extends { id: string }>({
  items,
  onReorder,
  renderItem,
  layout = "list",
  className,
  itemClassName,
}: {
  items: T[];
  onReorder: (items: T[]) => void;
  renderItem: (item: T, ctx: { handle: React.ReactNode; index: number; moveUp?: () => void; moveDown?: () => void }) => React.ReactNode;
  layout?: "list" | "grid";
  className?: string;
  itemClassName?: string;
}) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  function onDragEnd(e: DragEndEvent) {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const from = items.findIndex((i) => i.id === active.id);
    const to = items.findIndex((i) => i.id === over.id);
    if (from < 0 || to < 0) return;
    onReorder(arrayMove(items, from, to));
  }

  const move = (from: number, to: number) => () => onReorder(arrayMove(items, from, to));

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
      <SortableContext items={items.map((i) => i.id)} strategy={layout === "grid" ? rectSortingStrategy : verticalListSortingStrategy}>
        <ul className={className}>
          {items.map((item, index) => (
            <SortableItem key={item.id} id={item.id} className={itemClassName}>
              {(handle) =>
                renderItem(item, {
                  handle,
                  index,
                  moveUp: index > 0 ? move(index, index - 1) : undefined,
                  moveDown: index < items.length - 1 ? move(index, index + 1) : undefined,
                })
              }
            </SortableItem>
          ))}
        </ul>
      </SortableContext>
    </DndContext>
  );
}

function SortableItem({ id, children, className }: { id: string; children: (handle: React.ReactNode) => React.ReactNode; className?: string }) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id });
  const handle = (
    <button
      type="button"
      ref={setActivatorNodeRef}
      {...attributes}
      {...listeners}
      aria-label="Drag to reorder"
      className="flex h-8 w-8 shrink-0 cursor-grab touch-none items-center justify-center rounded text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700 active:cursor-grabbing"
    >
      <svg viewBox="0 0 16 16" className="h-4 w-4" fill="currentColor" aria-hidden="true">
        <circle cx="5.5" cy="3.5" r="1.2" />
        <circle cx="10.5" cy="3.5" r="1.2" />
        <circle cx="5.5" cy="8" r="1.2" />
        <circle cx="10.5" cy="8" r="1.2" />
        <circle cx="5.5" cy="12.5" r="1.2" />
        <circle cx="10.5" cy="12.5" r="1.2" />
      </svg>
    </button>
  );
  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn(className, isDragging && "relative z-10 opacity-80 shadow-lg")}
    >
      {children(handle)}
    </li>
  );
}

export function MoveButtons({ moveUp, moveDown, labelUp = "Move up", labelDown = "Move down" }: { moveUp?: () => void; moveDown?: () => void; labelUp?: string; labelDown?: string }) {
  return (
    <span className="inline-flex">
      <button type="button" onClick={moveUp} disabled={!moveUp} aria-label={labelUp} className="rounded p-1 text-neutral-500 hover:bg-neutral-100 disabled:opacity-30">
        <svg viewBox="0 0 16 16" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
          <path d="M4 10l4-4 4 4" />
        </svg>
      </button>
      <button type="button" onClick={moveDown} disabled={!moveDown} aria-label={labelDown} className="rounded p-1 text-neutral-500 hover:bg-neutral-100 disabled:opacity-30">
        <svg viewBox="0 0 16 16" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
          <path d="M4 6l4 4 4-4" />
        </svg>
      </button>
    </span>
  );
}

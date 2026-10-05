import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import TaskItem from "@tiptap/extension-task-item";
import TaskList from "@tiptap/extension-task-list";
import type { ReactNode } from "react";
import type { RichTextDocument } from "../types";

export function NoteEditor({
  content,
  onChange,
  disabled,
}: {
  content: RichTextDocument;
  onChange: (content: RichTextDocument, plainText: string) => void;
  disabled?: boolean;
}) {
  const editor = useEditor({
    extensions: [
      StarterKit.configure({ heading: { levels: [1, 2, 3] } }),
      TaskList,
      TaskItem.configure({ nested: true }),
    ],
    content,
    editable: !disabled,
    immediatelyRender: false,
    onUpdate: ({ editor: current }) => {
      onChange(current.getJSON() as RichTextDocument, current.getText({ blockSeparator: "\n" }));
    },
  });

  if (!editor) return <div className="note-editor-loading" />;

  const command = (run: () => boolean) => {
    run();
    editor.commands.focus();
  };

  return (
    <div className="note-editor-shell">
      <div className="note-toolbar" role="toolbar" aria-label="Форматирование заметки">
        <ToolbarButton
          label="Отменить"
          active={false}
          disabled={!editor.can().undo()}
          onClick={() => command(() => editor.chain().focus().undo().run())}
        >
          ↶
        </ToolbarButton>
        <ToolbarButton
          label="Повторить"
          active={false}
          disabled={!editor.can().redo()}
          onClick={() => command(() => editor.chain().focus().redo().run())}
        >
          ↷
        </ToolbarButton>
        <span className="note-toolbar-divider" />
        <ToolbarButton
          label="Жирный"
          active={editor.isActive("bold")}
          onClick={() => command(() => editor.chain().focus().toggleBold().run())}
        >
          B
        </ToolbarButton>
        <ToolbarButton
          label="Курсив"
          active={editor.isActive("italic")}
          onClick={() => command(() => editor.chain().focus().toggleItalic().run())}
        >
          <i>I</i>
        </ToolbarButton>
        <ToolbarButton
          label="Заголовок"
          active={editor.isActive("heading", { level: 2 })}
          onClick={() => command(() => editor.chain().focus().toggleHeading({ level: 2 }).run())}
        >
          H
        </ToolbarButton>
        <ToolbarButton
          label="Маркированный список"
          active={editor.isActive("bulletList")}
          onClick={() => command(() => editor.chain().focus().toggleBulletList().run())}
        >
          •
        </ToolbarButton>
        <ToolbarButton
          label="Нумерованный список"
          active={editor.isActive("orderedList")}
          onClick={() => command(() => editor.chain().focus().toggleOrderedList().run())}
        >
          1.
        </ToolbarButton>
        <ToolbarButton
          label="Список задач"
          active={editor.isActive("taskList")}
          onClick={() => command(() => editor.chain().focus().toggleTaskList().run())}
        >
          ☑
        </ToolbarButton>
      </div>
      <EditorContent editor={editor} className="note-editor" />
    </div>
  );
}

function ToolbarButton({
  label,
  active,
  disabled,
  onClick,
  children,
}: {
  label: string;
  active: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      className={`note-toolbar-button ${active ? "note-toolbar-button-active" : ""}`}
      aria-label={label}
      aria-pressed={active}
      disabled={disabled}
      onMouseDown={(event) => event.preventDefault()}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

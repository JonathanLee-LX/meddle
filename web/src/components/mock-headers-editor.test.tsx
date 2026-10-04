import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { MockHeadersEditor, parseHeaderObject, serializeHeaderEntries } from './mock-headers-editor'

vi.mock('./monaco-editor', () => ({
  MonacoEditor: ({
    value,
    onChange,
    language,
    className,
  }: {
    value?: string
    onChange?: (value: string) => void
    language?: string
    className?: string
  }) => (
    <textarea
      data-testid="mock-headers-code"
      data-language={language}
      className={className}
      value={value ?? ''}
      onChange={(event) => onChange?.(event.target.value)}
    />
  ),
}))

describe('mock header JSON helpers', () => {
  it('parses an object and skips blank names when serializing', () => {
    expect(parseHeaderObject('{"X-Test":1,"Empty":""}')).toEqual({
      entries: [
        { key: 'X-Test', value: '1' },
        { key: 'Empty', value: '' },
      ],
      error: null,
    })
    expect(serializeHeaderEntries([
      { key: ' ', value: 'nope' },
      { key: 'X-Test', value: '1' },
      { key: 'X-Test', value: '2' },
    ])).toBe('{\n  "X-Test": "2"\n}')
  })

  it('rejects arrays and broken JSON', () => {
    expect(parseHeaderObject('[]').error).toBe('响应头必须是 JSON 对象')
    expect(parseHeaderObject('{').error).toBe('响应头 JSON 无法解析')
    expect(parseHeaderObject('').entries).toEqual([])
  })
})

describe('MockHeadersEditor', () => {
  it('edits headers as a list and writes JSON', () => {
    const onChange = vi.fn()
    render(<MockHeadersEditor value={'{\n  "X-Test": "1"\n}'} onChange={onChange} />)

    expect(screen.getByLabelText('响应头名称 1')).toHaveValue('X-Test')
    fireEvent.change(screen.getByLabelText('响应头值 1'), { target: { value: '2' } })
    expect(onChange).toHaveBeenLastCalledWith('{\n  "X-Test": "2"\n}')

    fireEvent.click(screen.getByRole('button', { name: '添加' }))
    fireEvent.change(screen.getByLabelText('响应头名称 2'), { target: { value: 'X-New' } })
    expect(onChange).toHaveBeenLastCalledWith('{\n  "X-Test": "2",\n  "X-New": ""\n}')

    fireEvent.click(screen.getByRole('button', { name: '删除响应头 1' }))
    expect(onChange).toHaveBeenLastCalledWith('{\n  "X-New": ""\n}')
  })

  it('switches to the JSON code editor and back', () => {
    const onChange = vi.fn()
    const { rerender } = render(<MockHeadersEditor value="{}" onChange={onChange} />)

    fireEvent.mouseDown(screen.getByTestId('mock-headers-view-code'), { button: 0, ctrlKey: false })
    const code = screen.getByTestId('mock-headers-code')
    expect(code).toHaveAttribute('data-language', 'json')
    expect(code).toHaveValue('{}')

    fireEvent.change(code, { target: { value: '{\n  "A": "b"\n}' } })
    expect(onChange).toHaveBeenLastCalledWith('{\n  "A": "b"\n}')

    rerender(<MockHeadersEditor value={'{\n  "A": "b"\n}'} onChange={onChange} />)
    fireEvent.mouseDown(screen.getByTestId('mock-headers-view-list'), { button: 0, ctrlKey: false })
    expect(screen.getByLabelText('响应头名称 1')).toHaveValue('A')
    expect(screen.getByLabelText('响应头值 1')).toHaveValue('b')
  })

  it('resizes the code editor by dragging its bottom edge', () => {
    render(<MockHeadersEditor value="{}" onChange={vi.fn()} />)
    fireEvent.mouseDown(screen.getByTestId('mock-headers-view-code'), { button: 0, ctrlKey: false })
    const handle = screen.getByTestId('mock-headers-resize')
    expect(handle.parentElement).toHaveStyle({ height: '180px' })

    fireEvent.mouseDown(handle, { clientY: 200 })
    fireEvent.mouseMove(document, { clientY: 280 })
    fireEvent.mouseUp(document)
    expect(handle.parentElement).toHaveStyle({ height: '260px' })

    fireEvent.mouseDown(handle, { clientY: 280 })
    fireEvent.mouseMove(document, { clientY: 40 })
    fireEvent.mouseUp(document)
    expect(handle.parentElement).toHaveStyle({ height: '120px' })
  })

  it('keeps invalid code out of the list until it parses', () => {
    const onChange = vi.fn()
    const { rerender } = render(<MockHeadersEditor value={'{\n  "A": "b"\n}'} onChange={onChange} />)
    fireEvent.mouseDown(screen.getByTestId('mock-headers-view-code'), { button: 0, ctrlKey: false })
    fireEvent.change(screen.getByTestId('mock-headers-code'), { target: { value: '{' } })
    rerender(<MockHeadersEditor value="{" onChange={onChange} />)
    fireEvent.mouseDown(screen.getByTestId('mock-headers-view-list'), { button: 0, ctrlKey: false })
    expect(screen.getByTestId('mock-headers-parse-error')).toHaveTextContent('响应头 JSON 无法解析')
    expect(screen.queryByLabelText('响应头名称 1')).not.toBeInTheDocument()
  })
})

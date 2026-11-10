import { useState } from 'react'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { ConfirmDeleteDialog } from './confirm-delete-dialog'

function deferred() {
  let resolve!: () => void
  let reject!: (error: Error) => void
  const promise = new Promise<void>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

function Harness({
  confirmLabel = '删除' as '删除' | '清空',
  onConfirm = vi.fn(),
}: {
  confirmLabel?: '删除' | '清空'
  onConfirm?: () => void | Promise<void>
}) {
  const [open, setOpen] = useState(false)
  const [items, setItems] = useState(['example.com'])
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        打开确认
      </button>
      <p>{items.join(',')}</p>
      <ConfirmDeleteDialog
        open={open}
        onOpenChange={setOpen}
        title={confirmLabel === '清空' ? '清空流量日志' : '删除规则'}
        description="确定继续吗？"
        confirmLabel={confirmLabel}
        onConfirm={async () => {
          await onConfirm()
          setItems([])
        }}
      />
    </>
  )
}

async function openDialog(user: ReturnType<typeof userEvent.setup>, confirmLabel: '删除' | '清空' = '删除') {
  await user.click(screen.getByRole('button', { name: '打开确认' }))
  const dialog = await screen.findByRole('alertdialog', { name: confirmLabel === '清空' ? '清空流量日志' : '删除规则' })
  return dialog
}

describe('ConfirmDeleteDialog', () => {
  it('focuses 取消 and does not confirm when opened, cancelled, closed, or dismissed with Escape', async () => {
    const user = userEvent.setup()
    const onConfirm = vi.fn()
    render(<Harness onConfirm={onConfirm} />)

    const dialog = await openDialog(user)
    expect(onConfirm).not.toHaveBeenCalled()
    expect(screen.getByText('example.com')).toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: '取消' })).toHaveFocus()
    expect(within(dialog).getByRole('button', { name: '删除' })).toHaveTextContent('删除')
    expect(within(dialog).getByRole('button', { name: '取消' })).toHaveTextContent('取消')

    await user.click(within(dialog).getByRole('button', { name: '取消' }))
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument())
    expect(onConfirm).not.toHaveBeenCalled()
    expect(screen.getByText('example.com')).toBeInTheDocument()

    const reopened = await openDialog(user)
    await user.click(within(reopened).getByRole('button', { name: '关闭' }))
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument())
    expect(onConfirm).not.toHaveBeenCalled()

    await openDialog(user)
    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument())
    expect(onConfirm).not.toHaveBeenCalled()
    expect(screen.getByText('example.com')).toBeInTheDocument()
  })

  it('shows a visible 清空 button and confirms only from that button', async () => {
    const user = userEvent.setup()
    const onConfirm = vi.fn()
    render(<Harness confirmLabel="清空" onConfirm={onConfirm} />)

    const dialog = await openDialog(user, '清空')
    expect(within(dialog).getByRole('button', { name: '清空' })).toHaveTextContent('清空')
    await user.click(within(dialog).getByRole('button', { name: '清空' }))

    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument())
    expect(onConfirm).toHaveBeenCalledTimes(1)
    expect(screen.queryByText('example.com')).not.toBeInTheDocument()
  })

  it('ignores a second confirm while the first is still running', async () => {
    const user = userEvent.setup()
    const gate = deferred()
    const onConfirm = vi.fn(() => gate.promise)
    render(<Harness onConfirm={onConfirm} />)

    const dialog = await openDialog(user)
    const confirm = within(dialog).getByRole('button', { name: '删除' })
    await user.click(confirm)
    expect(onConfirm).toHaveBeenCalledTimes(1)
    await waitFor(() => expect(confirm).toBeDisabled())
    fireEvent.click(confirm)
    expect(onConfirm).toHaveBeenCalledTimes(1)
    expect(screen.getByText('example.com')).toBeInTheDocument()

    gate.resolve()
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument())
    expect(onConfirm).toHaveBeenCalledTimes(1)
    expect(screen.queryByText('example.com')).not.toBeInTheDocument()
  })

  it('keeps the dialog open and does not apply the change when confirm fails', async () => {
    const user = userEvent.setup()
    const onConfirm = vi.fn(async () => {
      throw new Error('写入失败')
    })
    render(
      <Harness
        onConfirm={async () => {
          await onConfirm()
        }}
      />,
    )

    const dialog = await openDialog(user)
    await user.click(within(dialog).getByRole('button', { name: '删除' }))

    expect(await within(dialog).findByRole('alert')).toHaveTextContent('写入失败')
    expect(screen.getByRole('alertdialog', { name: '删除规则' })).toBeInTheDocument()
    expect(onConfirm).toHaveBeenCalledTimes(1)
    expect(screen.getByText('example.com')).toBeInTheDocument()
  })
})

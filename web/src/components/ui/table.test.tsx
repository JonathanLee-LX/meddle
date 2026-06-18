import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { Table, TableBody, TableCell, TableRow } from './table'

describe('TableRow', () => {
  it('uses the global accent color for selected rows', () => {
    render(
      <Table>
        <TableBody>
          <TableRow data-state="selected" data-testid="row">
            <TableCell>selected</TableCell>
          </TableRow>
        </TableBody>
      </Table>,
    )

    const row = screen.getByTestId('row')
    expect(row).toHaveClass('data-[state=selected]:bg-accent')
    expect(row).toHaveClass('data-[state=selected]:text-accent-foreground')
    expect(row).not.toHaveClass('data-[state=selected]:bg-muted')
  })
})

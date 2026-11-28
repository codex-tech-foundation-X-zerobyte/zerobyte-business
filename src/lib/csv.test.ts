import { describe, expect, it } from 'vitest'
import { cleanAmount, databaseMessage, parseCsv, readProductsCsv } from './csv'

describe('parseCsv', () => {
  it('reads quotes, doubled quotes and line breaks inside a cell', () => {
    expect(parseCsv('a,b\r\n"x, y","say ""hi"""\r\n"two\nlines",z')).toEqual([
      ['a', 'b'],
      ['x, y', 'say "hi"'],
      ['two\nlines', 'z'],
    ])
  })
  it('detects the semicolons Excel uses in some regions, ignores the BOM and blank lines', () => {
    expect(parseCsv('\ufeffname;price\n\nRice;5000\n;\n')).toEqual([
      ['name', 'price'],
      ['Rice', '5000'],
    ])
  })
})

describe('cleanAmount', () => {
  it('accepts naira signs and thousands separators', () => {
    expect(cleanAmount('₦1,500.50')).toBe('1500.5')
    expect(cleanAmount('NGN 2 500')).toBe('2500')
    expect(cleanAmount('N300')).toBe('300')
    expect(cleanAmount('12.345')).toBe('12.35')
  })
  it('rejects anything that is not an amount', () => {
    for (const bad of ['', 'abc', '-5', '1e5', '12abc', '5,5,5.x']) expect(cleanAmount(bad)).toBeNull()
  })
})

describe('readProductsCsv', () => {
  it('maps common header names in any order and fills the defaults', () => {
    const file = readProductsCsv(
      'Selling Price,Product Name,Qty,Buying price,Item code\n"₦5,000",5kg Rice,24,4200,RICE-5\n800,Peak milk,,,\n',
    )
    expect(file.fileError).toBe('')
    expect(file.problems).toEqual([])
    expect(file.products[0]).toEqual({
      name: '5kg Rice',
      sku: 'RICE-5',
      category: '',
      cost_price: '4200',
      price: '5000',
      stock: '24',
      reorder_point: '5',
    })
    expect(file.products[1]).toMatchObject({ name: 'Peak milk', price: '800', stock: '0', cost_price: '0', sku: '' })
  })
  it('lists bad rows with their spreadsheet row number and still returns the good ones', () => {
    const file = readProductsCsv('name,price,stock\nGood,100,5\n,200,1\nBad price,abc,1\nBad stock,10,2.5\nFine,20,0\n')
    expect(file.total).toBe(5)
    expect(file.products.map((product) => product.name)).toEqual(['Good', 'Fine'])
    expect(file.rows).toEqual([2, 6])
    expect(file.problems.map((problem) => problem.row)).toEqual([3, 4, 5])
    expect(file.problems[1].message).toContain('abc')
  })
  it('explains a file that cannot be read', () => {
    expect(readProductsCsv('').fileError).toContain('no products')
    expect(readProductsCsv('colour,size\nred,big\n').fileError).toContain('name')
    expect(readProductsCsv('name,qty\nRice,5\n').fileError).toContain('selling price')
  })
})

describe('databaseMessage', () => {
  it('shows the readable message of a structured database error', () => {
    expect(
      databaseMessage(
        { message: '{"code":"VALIDATION_ERROR","message":"Row 2: the selling price must be a number"}' },
        'x',
      ),
    ).toBe('Row 2: the selling price must be a number')
    expect(databaseMessage({ message: 'plain failure' }, 'x')).toBe('plain failure')
    expect(databaseMessage(null, 'fallback')).toBe('fallback')
  })
})

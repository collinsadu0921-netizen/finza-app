# Finza UI Patterns Guide

## 🎯 How to Apply UI Improvements to Any Page

### 1. Replace Loading States

**Before:**
```tsx
if (loading) {
  return <div>Loading...</div>
}
```

**After:**
```tsx
import LoadingScreen from "@/components/ui/LoadingScreen"

if (loading) {
  return (
    <ProtectedLayout>
      <LoadingScreen />
    </ProtectedLayout>
  )
}
```

### 2. Standardize Page Headers

**Before:**
```tsx
<div className="flex justify-between items-center mb-8">
  <h1>Page Title</h1>
  <button onClick={...}>Action</button>
</div>
```

**After:**
```tsx
import PageHeader from "@/components/ui/PageHeader"
import Button from "@/components/ui/Button"

<PageHeader
  title="Page Title"
  subtitle="Optional subtitle"
  actions={
    <Button onClick={...}>Action</Button>
  }
/>
```

### 3. Add Empty States

**Before:**
```tsx
{items.length === 0 && (
  <div className="text-center">
    <p>No items found</p>
  </div>
)}
```

**After:**
```tsx
import EmptyState from "@/components/ui/EmptyState"

{items.length === 0 && (
  <EmptyState
    icon={<YourIcon />}
    title="No items found"
    description="Get started by creating your first item"
    actionLabel="Create First Item"
    onAction={() => router.push("/items/create")}
  />
)}
```

### 4. Add Toast Notifications

**Before:**
```tsx
setSuccess("Item created!")
```

**After:**
```tsx
import { useToast } from "@/components/ui/ToastProvider"

const toast = useToast()

// On success
toast.showToast("Item created successfully!", "success")

// On error
toast.showToast("Failed to create item", "error")
```

### 5. Replace Inline Buttons

**Before:**
```tsx
<button className="bg-blue-600 text-white px-4 py-2 rounded">
  Click Me
</button>
```

**After:**
```tsx
import Button from "@/components/ui/Button"

<Button variant="primary" onClick={...}>
  Click Me
</Button>
```

### 6. Standardize Tables

**Before:**
```tsx
<table className="w-full">
  <thead>...</thead>
  <tbody>...</tbody>
</table>
```

**After:**
```tsx
import Table from "@/components/ui/Table"

<Table
  headers={["Column 1", "Column 2", "Actions"]}
  emptyMessage={items.length === 0 ? "No items found" : undefined}
  emptyAction={items.length === 0 ? {
    label: "Create First Item",
    onClick: () => router.push("/items/create")
  } : undefined}
>
  {items.map(item => (
    <tr key={item.id}>...</tr>
  ))}
</Table>
```

### 7. Replace Hard Reloads

**Before:**
```tsx
window.location.reload()
```

**After:**
```tsx
import { useRouter } from "next/navigation"

const router = useRouter()
router.refresh() // or router.push(currentPath)
```

### 8. Add Form Validation Messages

**Before:**
```tsx
{error && <p className="text-red-500">{error}</p>}
```

**After:**
```tsx
{error && (
  <div className="bg-red-50 dark:bg-red-900/20 border-l-4 border-red-400 text-red-700 dark:text-red-400 px-4 py-3 rounded mb-4">
    {error}
  </div>
)}
```

## 📋 Checklist for Each Page

- [ ] Replace loading state with LoadingScreen
- [ ] Use PageHeader component
- [ ] Replace buttons with Button component
- [ ] Add empty state
- [ ] Add toast notifications for actions
- [ ] Standardize table (if applicable)
- [ ] Remove hard reloads
- [ ] Improve error messages
- [ ] Add consistent spacing
- [ ] Test responsive design

## 🎨 Component Usage Examples

### Button Variants
```tsx
<Button variant="primary">Primary</Button>
<Button variant="secondary">Secondary</Button>
<Button variant="danger">Delete</Button>
<Button variant="outline">Cancel</Button>
<Button variant="ghost">Ghost</Button>
```

### Toast Types
```tsx
toast.showToast("Success!", "success")
toast.showToast("Error occurred", "error")
toast.showToast("Information", "info")
toast.showToast("Warning", "warning")
```

### Modal Usage
```tsx
import Modal from "@/components/ui/Modal"

<Modal
  isOpen={isOpen}
  onClose={() => setIsOpen(false)}
  title="Modal Title"
  size="md"
  footer={
    <>
      <Button variant="outline" onClick={...}>Cancel</Button>
      <Button variant="primary" onClick={...}>Save</Button>
    </>
  }
>
  Modal content here
</Modal>
```

## 🚀 Quick Wins

1. **Global**: ToastProvider already added to layout
2. **Global**: All components created and ready
3. **Next**: Update invoices page (example done)
4. **Then**: Apply to expenses, bills, customers, etc.

## 📝 Notes

- All components support dark mode
- All components are responsive
- Animations are subtle and smooth
- Consistent spacing and typography
- Accessible (keyboard navigation, ARIA labels)


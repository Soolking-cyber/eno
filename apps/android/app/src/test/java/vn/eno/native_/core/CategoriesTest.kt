package vn.eno.native_.core

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

// The browse rail drops the shelves the web retired from navigation (second-hand focus, 2026-10-03; the
// web's RETIRED_NAV_CATEGORIES), keeps one while it is the active filter (the web rail's rule), and posting
// keeps them all — the web keeps those shelves postable (src/lib/retired-categories.ts).
class CategoriesTest {
    private val retired = setOf("vehicles", "pets", "books-stationery", "hobbies-sports")

    @Test
    fun browseOmitsRetiredShelves() {
        assertEquals(retired, Categories.retiredFromBrowse)
        assertEquals(Categories.all.map { it.slug }.filter { it !in retired }, Categories.browse.map { it.slug })
        assertTrue(Categories.browse.any { it.slug == "electronics" })
    }

    @Test
    fun railKeepsAnActiveRetiredShelf() {
        assertTrue(Categories.browseKeeping("vehicles").any { it.slug == "vehicles" })
        assertFalse(Categories.browseKeeping("vehicles").any { it.slug == "pets" })
        assertEquals(Categories.browse.map { it.slug }, Categories.browseKeeping(null).map { it.slug })
    }

    @Test
    fun retiredShelvesStayPostable() {
        val all = Categories.all.map { it.slug }.toSet()
        assertTrue("vehicles" in all && "pets" in all && "hobbies-sports" in all)
    }
}
